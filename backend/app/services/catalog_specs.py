"""多规格：规格树 + 笛卡尔积生成 SKU。

设计要点（都是踩过坑才这么定的）：

1. **SKU 只软删不硬删**：`cart_items` / `order_items` / `inventory_logs` 都外键指向
   `product_skus`，删组合会让历史订单挂空。组合消失时置 `status='inactive'`。
2. **按组合键匹配保存**：老组合保留价格/库存（运营可能已经调过），新组合补默认值，
   消失的组合停用 —— 而不是「全删重建」，否则每次保存都把价格库存清零。
3. **sku_code 必须唯一**：`SKU-{product_id}-{组合哈希前 8 位}`，同一个组合多次保存得到
   同一个编码，新增组合自然不同。
"""

from __future__ import annotations

import hashlib
import itertools
import json

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import (
    InventoryLog,
    Product,
    ProductSku,
    ProductSpecGroup,
    ProductSpecValue,
)
from app.schemas.commerce import ProductSpecsUpdate
from app.services import attachment as attachment_service

MAX_GROUPS = 3


def combo_key(specs: dict[str, str] | None) -> str:
    """组合键：按组名排序后序列化，保证 `{颜色,尺码}` 与 `{尺码,颜色}` 视为同一组合。"""
    if not specs:
        return ""
    return json.dumps(
        {str(k): str(v) for k, v in sorted(specs.items())}, ensure_ascii=False, sort_keys=True
    )


def sku_code_for(product_id: int, key: str) -> str:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
    return f"SKU-{product_id}-{digest}" if key else f"SKU-{product_id}"


def sku_name_for(specs: dict[str, str]) -> str:
    return " / ".join(specs[name] for name in specs) if specs else "默认"


async def load_spec_groups(db: AsyncSession, product_id: int) -> list[dict]:
    groups = list(
        (
            await db.scalars(
                select(ProductSpecGroup)
                .where(ProductSpecGroup.product_id == product_id)
                .order_by(ProductSpecGroup.sort, ProductSpecGroup.id)
            )
        ).all()
    )
    if not groups:
        return []
    values = list(
        (
            await db.scalars(
                select(ProductSpecValue)
                .where(ProductSpecValue.group_id.in_([group.id for group in groups]))
                .order_by(ProductSpecValue.sort, ProductSpecValue.id)
            )
        ).all()
    )
    by_group: dict[int, list[dict]] = {}
    for row in values:
        by_group.setdefault(row.group_id, []).append(
            {
                "value": row.value,
                "image_url": row.image_url,
                "video_url": row.video_url,
            }
        )
    return [
        {"name": group.name, "values": by_group.get(group.id, [])} for group in groups
    ]


async def save_specs(
    db: AsyncSession, product: Product, payload: ProductSpecsUpdate, tenant_id: int
) -> list[ProductSku]:
    """整体保存规格树，返回保存后的全部 SKU。"""
    if len(payload.groups) > MAX_GROUPS:
        raise HTTPException(status_code=400, detail=f"规格最多 {MAX_GROUPS} 级")

    names = [group.name.strip() for group in payload.groups]
    if len({name.lower() for name in names}) != len(names):
        raise HTTPException(status_code=400, detail="规格组名称不能重复")
    for group in payload.groups:
        values = [item.value.strip() for item in group.values]
        if len(set(values)) != len(values):
            raise HTTPException(
                status_code=400, detail=f"规格组「{group.name}」下的规格值不能重复"
            )

    existing = list(
        (
            await db.scalars(select(ProductSku).where(ProductSku.product_id == product.id))
        ).all()
    )
    by_key = {combo_key(sku.specs): sku for sku in existing}
    incoming = {combo_key(item.specs): item for item in payload.skus}

    # 1) 重建规格树（值上带图/视频）
    old_groups = list(
        (
            await db.scalars(
                select(ProductSpecGroup).where(ProductSpecGroup.product_id == product.id)
            )
        ).all()
    )
    if old_groups:
        await db.execute(
            delete(ProductSpecValue).where(
                ProductSpecValue.group_id.in_([group.id for group in old_groups])
            )
        )
        await db.execute(
            delete(ProductSpecGroup).where(
                ProductSpecGroup.id.in_([group.id for group in old_groups])
            )
        )
        await db.flush()
    for index, group in enumerate(payload.groups):
        row = ProductSpecGroup(product_id=product.id, name=group.name.strip(), sort=index)
        db.add(row)
        await db.flush()
        for value_index, value in enumerate(group.values):
            db.add(
                ProductSpecValue(
                    group_id=row.id,
                    value=value.value.strip(),
                    image_url=value.image_url,
                    video_url=value.video_url,
                    sort=value_index,
                )
            )

    # 2) 规格值为空 = 单规格商品：保留唯一那条 SKU，把多余的停用
    if not payload.groups:
        combos: list[dict[str, str]] = [{}]
    else:
        combos = [
            dict(zip(names, combo, strict=False))
            for combo in itertools.product(*[[item.value.strip() for item in g.values] for g in payload.groups])
        ]

    kept: list[ProductSku] = []
    combo_keys = {combo_key(combo) for combo in combos}
    for combo in combos:
        key = combo_key(combo)
        item = incoming.get(key)
        sku = by_key.get(key)
        if sku is None:
            sku = ProductSku(
                tenant_id=tenant_id,
                seller_id=product.seller_id,
                product_id=product.id,
                sku_code=sku_code_for(product.id, key),
                name=sku_name_for(combo),
                price_cents=(item.price_cents if item and item.price_cents else 0),
                stock=(item.stock if item and item.stock is not None else 0),
                status=(item.status if item else "active"),
                specs=combo or None,
                image_url=(item.image_url if item else None),
                video_url=(item.video_url if item else None),
            )
            db.add(sku)
        else:
            sku.name = sku_name_for(combo)
            sku.specs = combo or None
            if item is not None:
                if item.price_cents is not None:
                    sku.price_cents = item.price_cents
                if item.stock is not None and item.stock != sku.stock:
                    if item.stock < sku.locked_stock:
                        raise HTTPException(
                            status_code=400,
                            detail=f"「{sku.name}」库存不能低于已锁定数量（{sku.locked_stock}）",
                        )
                    db.add(
                        InventoryLog(
                            tenant_id=tenant_id,
                            seller_id=sku.seller_id,
                            sku_id=sku.id,
                            change=item.stock - sku.stock,
                            reason="spec_adjust",
                        )
                    )
                    sku.stock = item.stock
                sku.image_url = item.image_url
                sku.video_url = item.video_url
                sku.status = item.status
            else:
                sku.status = "active"
        kept.append(sku)

    # 3) 组合消失的 SKU 只停用，不删行（订单/购物车/库存流水还指着它）
    for key, sku in by_key.items():
        if key not in combo_keys:
            sku.status = "inactive"

    # 4) **不再自动打回待审核**。
    #
    # 这里原来无条件把在售商品改成 `pending_review`，结果：运营只是在编辑器里换了个
    # 主图 / 改了个库存，商品也会立刻从「在售」变成「待审核」，买家端直接搜不到——
    # 看起来就像「主图保存了但不显示」。
    #
    # 口径：**运营自己就是审核方**，运营端的保存不需要自我重审；
    # 卖家改内容仍会打回待审（在 `seller_center.update_seller_product` 里，与这里无关）。

    # 5) 规格值 / SKU 上的图与视频也要对匿名访客可见，否则前台就是破图
    for group in payload.groups:
        for value in group.values:
            await attachment_service.publish_by_public_url(
                db, tenant_id, value.image_url
            )
            await attachment_service.publish_by_public_url(
                db, tenant_id, value.video_url
            )
    for item in payload.skus:
        await attachment_service.publish_by_public_url(db, tenant_id, item.image_url)
        await attachment_service.publish_by_public_url(db, tenant_id, item.video_url)

    await db.commit()
    for sku in kept:
        await db.refresh(sku)
    return kept

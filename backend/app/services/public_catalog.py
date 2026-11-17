"""公开商品橱窗：站点根页「商品」内页用，无需登录。

字段白名单是硬约束 —— 这是对匿名访客开放的接口：

* 只返回商品展示信息（名称/副标题/主图/首个 SKU 的价格与库存）；
* 只返回 on_sale 商品、且卖家必须 active；
* 不暴露卖家状态、KYC、用户、订单、财务等内部字段；
* 租户不存在或非 active 一律 404，不泄露租户是否存在。

返回结构与前端 PortalProduct 保持一致，商品卡片可直接复用。
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Category, Product, ProductSku
from app.models.interaction import ProductFavorite
from app.models.order import OrderItem, SellerOrder
from app.models.seller import Seller, Shop
from app.models.tenant import Tenant
from app.models.user import User
from app.services import catalog_specs, catalog_stats

DEFAULT_TENANT_SLUG = "demo"
DEFAULT_LIMIT = 48
MAX_LIMIT = 120

# 排序：前端传 code，服务端在这里翻译成 SQL（不把排序字段名暴露给外部）
SORT_DEFAULT = "default"
SORT_SOLD_DESC = "sold_desc"
SORT_NEWEST = "newest"
SORT_PRICE_ASC = "price_asc"
SORT_PRICE_DESC = "price_desc"
SORT_OPTIONS = (
    SORT_DEFAULT,
    SORT_SOLD_DESC,
    SORT_NEWEST,
    SORT_PRICE_ASC,
    SORT_PRICE_DESC,
)
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 60


async def resolve_tenant(db: AsyncSession, slug: str) -> Tenant:
    """公开的租户解析入口（品牌 / 商品列表都要用）。"""
    return await _resolve_tenant(db, slug)


async def _resolve_tenant(db: AsyncSession, slug: str) -> Tenant:
    """按 slug 解析租户；非 active 与不存在同样处理，避免被探测。"""
    tenant = (
        await db.scalars(select(Tenant).where(Tenant.slug == slug, Tenant.status == "active"))
    ).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="站点不存在或已停用")
    return tenant


def _product_public_dict(product, shop, seller, sku) -> dict:
    """列表与详情共用的一份字段白名单。

    **副标题已全站下线**（产品决定）：不再返回 `subtitle`。
    数据库列保留（历史数据不丢），但接口、搜索、界面都不再读写它。
    """
    return {
        "id": product.id,
        "seller_id": product.seller_id,
        "shop_id": product.shop_id,
        "name": product.name,
        "status": product.status,
        # 商品类型：详情页要显示标签；买家侧目前只有实物
        "product_type": product.product_type,
        # 交付方式：买家下单要按卖家选快递/自提，详情页先告诉他能选什么
        "delivery_methods": product.delivery_methods or [],
        "main_image": product.main_image,
        "shop_name": shop.name,
        "seller_name": seller.display_name,
        "sku": (
            {
                "id": sku.id,
                "name": sku.name,
                "price_cents": sku.price_cents,
                "stock": sku.stock,
            }
            if sku is not None
            else None
        ),
    }


async def _category_scope_ids(db: AsyncSession, category_id: int | None) -> list[int] | None:
    """选中一级分类时，商品可能挂在它的子类下 —— 一次把整棵子树 id 取出来。

    现在库里只有一级分类，这一步等于 `[category_id]`；但结构上有 `parent_id`，
    提前按子树处理，将来加子类时筛选不会静默漏数据。
    """
    if category_id is None:
        return None
    children = (
        await db.scalars(select(Category.id).where(Category.parent_id == category_id))
    ).all()
    return [category_id, *children]


def _product_filters(
    tenant_id: int,
    *,
    keyword: str | None,
    category_ids: list[int] | None,
    min_price_cents: int | None,
    max_price_cents: int | None,
    seller_id: int | None = None,
):
    """列表与 count 共用的过滤条件（两处必须一模一样，否则总数对不上）。"""
    filters = [
        Product.tenant_id == tenant_id,
        Product.status == "on_sale",
        Seller.status == "active",
    ]
    if seller_id is not None:
        # 买家在会话里只能挑「这个卖家」的商品（发消息时服务端会再校验一次）
        filters.append(Product.seller_id == seller_id)
    if category_ids is not None:
        filters.append(Product.category_id.in_(category_ids))
    if keyword:
        pattern = f"%{keyword.strip()}%"
        filters.append(
            or_(
                Product.name.ilike(pattern),
                Shop.name.ilike(pattern),
                Seller.display_name.ilike(pattern),
                User.username.ilike(pattern),
                # 富文本描述抽出来的纯文本：搜 HTML 会命中一堆标签垃圾，只搜它
                Product.description_text.ilike(pattern),
            )
        )
    # 价格按「在售 SKU 的最低价」判，与卡片上展示的价格同口径
    if min_price_cents is not None:
        filters.append(_price_min_sq.c.price_min >= min_price_cents)
    if max_price_cents is not None:
        filters.append(_price_min_sq.c.price_min <= max_price_cents)
    return filters


# 下面几个子查询是「排序/筛选要用，但不能逐商品去查」的聚合。
# 全部在 SQL 里一次算完，避免 Python 侧 N+1。
_price_min_sq = (
    select(
        ProductSku.product_id.label("product_id"),
        func.min(ProductSku.price_cents).label("price_min"),
    )
    .where(ProductSku.status == "active")
    .group_by(ProductSku.product_id)
    .subquery("price_min")
)

_in_stock_sq = (
    select(
        ProductSku.product_id.label("product_id"),
        func.max(case((ProductSku.stock > 0, 1), else_=0)).label("in_stock"),
    )
    .where(ProductSku.status == "active")
    .group_by(ProductSku.product_id)
    .subquery("stock_any")
)

_sold_sq = (
    select(
        OrderItem.product_id.label("product_id"),
        func.sum(OrderItem.quantity).label("sold"),
    )
    .join(SellerOrder, SellerOrder.id == OrderItem.seller_order_id)
    .where(SellerOrder.fulfillment_status.in_(catalog_stats.SOLD_STATUSES))
    .group_by(OrderItem.product_id)
    .subquery("sold")
)

_favorite_sq = (
    select(
        ProductFavorite.product_id.label("product_id"),
        func.count(ProductFavorite.id).label("favorites"),
    )
    .group_by(ProductFavorite.product_id)
    .subquery("favorites")
)


def _order_by(sort: str):
    """排序表达式。未知值一律回落到综合排序，不报 400 —— 链接被人手改不应该白屏。"""
    sold = func.coalesce(_sold_sq.c.sold, 0)
    favorites = func.coalesce(_favorite_sq.c.favorites, 0)
    in_stock = func.coalesce(_in_stock_sq.c.in_stock, 0)
    if sort == SORT_SOLD_DESC:
        return (sold.desc(), Product.created_at.desc(), Product.id.desc())
    if sort == SORT_NEWEST:
        return (Product.created_at.desc(), Product.id.desc())
    if sort == SORT_PRICE_ASC:
        return (
            _price_min_sq.c.price_min.asc().nulls_last(),
            Product.created_at.desc(),
        )
    if sort == SORT_PRICE_DESC:
        return (
            _price_min_sq.c.price_min.desc().nulls_last(),
            Product.created_at.desc(),
        )
    # 综合：有货优先 → 销量 → 收藏 → 发布时间。
    # 故意不用加权打分：权重一变结果就漂，没法解释也没法验收。
    return (
        in_stock.desc(),
        sold.desc(),
        favorites.desc(),
        Product.created_at.desc(),
        Product.id.desc(),
    )


async def list_public_products(
    db: AsyncSession,
    slug: str = DEFAULT_TENANT_SLUG,
    *,
    keyword: str | None = None,
    category_id: int | None = None,
    min_price_cents: int | None = None,
    max_price_cents: int | None = None,
    sort: str = SORT_DEFAULT,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    seller_id: int | None = None,
) -> dict:
    """在售商品列表（公开）：搜索 + 分类 + 价格区间 + 排序 + 分页。

    多规格后不能再拿「第一条 SKU」当报价：那条可能是下架的/售罄的。
    列表统一用**可用 SKU 的起售价**（`price_min_cents`），并给出价格区间与规格数，
    卡片据此显示「¥xx 起」。

    返回 `{list, total, page, pageSize}` —— 有分页就必须有总数，
    否则前端只能"捞一把"。
    """
    tenant = await _resolve_tenant(db, slug)
    bounded_page = max(1, page)
    bounded_size = max(1, min(page_size, MAX_PAGE_SIZE))
    category_ids = await _category_scope_ids(db, category_id)
    filters = _product_filters(
        tenant.id,
        keyword=keyword,
        category_ids=category_ids,
        min_price_cents=min_price_cents,
        max_price_cents=max_price_cents,
        seller_id=seller_id,
    )

    base = (
        select(Product)
        .join(Shop, Shop.id == Product.shop_id)
        .join(Seller, Seller.id == Product.seller_id)
        .join(User, User.id == Seller.owner_user_id, isouter=True)
        # 价格子查询必须和过滤条件用**同一个 join**，否则 count 会退化成笛卡尔积（总数虚高）
        .join(_price_min_sq, _price_min_sq.c.product_id == Product.id, isouter=True)
        .where(*filters)
    )
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)

    rows = (
        await db.execute(
            base.join(_in_stock_sq, _in_stock_sq.c.product_id == Product.id, isouter=True)
            .join(_sold_sq, _sold_sq.c.product_id == Product.id, isouter=True)
            .join(_favorite_sq, _favorite_sq.c.product_id == Product.id, isouter=True)
            .order_by(*_order_by(sort))
            .offset((bounded_page - 1) * bounded_size)
            .limit(bounded_size)
        )
    ).all()

    product_ids = [row[0].id for row in rows]
    shops = {}
    sellers = {}
    if product_ids:
        for shop in (await db.scalars(select(Shop).where(Shop.id.in_({r[0].shop_id for r in rows})))).all():
            shops[shop.id] = shop
        for seller in (
            await db.scalars(select(Seller).where(Seller.id.in_({r[0].seller_id for r in rows})))
        ).all():
            sellers[seller.id] = seller

    all_skus = []
    if product_ids:
        all_skus = list(
            (
                await db.scalars(
                    select(ProductSku)
                    .where(
                        ProductSku.tenant_id == tenant.id,
                        ProductSku.product_id.in_(product_ids),
                        ProductSku.status == "active",
                    )
                    .order_by(ProductSku.id)
                )
            ).all()
        )
    skus_by_product: dict[int, list[ProductSku]] = {}
    for sku in all_skus:
        skus_by_product.setdefault(sku.product_id, []).append(sku)

    result: list[dict] = []
    for (product,) in rows:
        shop = shops.get(product.shop_id)
        seller = sellers.get(product.seller_id)
        if seller is None:
            continue
        skus = skus_by_product.get(product.id, [])
        payload = _product_public_dict(product, shop, seller, skus[0] if skus else None)
        prices = [sku.price_cents for sku in skus]
        payload["price_min_cents"] = min(prices) if prices else None
        payload["price_max_cents"] = max(prices) if prices else None
        payload["sku_count"] = len(skus)
        # 列表卡片用：是否还有可买的 SKU（多规格时引导去详情选）
        payload["in_stock"] = any(sku.stock > 0 for sku in skus)
        result.append(payload)

    # 卡片上的「已售 N / ★4.8」：与运营端、卖家端同一份口径
    stats = await catalog_stats.stats_map(db, tenant_id=tenant.id, product_ids=product_ids)
    for payload, (product,) in zip(result, rows):
        stat = stats.get(product.id)
        payload["sold_count"] = stat.sold_count if stat else 0
        payload["favorite_count"] = stat.favorite_count if stat else 0
        payload["rating_avg"] = stat.rating_avg if stat else None
        payload["review_count"] = stat.review_count if stat else 0
        # 卡片要展示浏览量（详情页才有的字段，列表也一并给）
        payload["view_count"] = product.view_count or 0

    return {
        "list": result,
        "total": total,
        "page": bounded_page,
        "pageSize": bounded_size,
    }


async def get_public_product(
    db: AsyncSession,
    product_id: int,
    slug: str = DEFAULT_TENANT_SLUG,
    viewer_id: int | None = None,
) -> dict:
    """公开商品详情。非在售 / 卖家非 active / 跨租户一律 404，不区分原因。"""
    tenant = await _resolve_tenant(db, slug)
    row = (
        await db.execute(
            select(Product, Shop, Seller)
            .join(Shop, Shop.id == Product.shop_id)
            .join(Seller, Seller.id == Product.seller_id)
            .where(
                Product.tenant_id == tenant.id,
                Product.id == product_id,
                Product.status == "on_sale",
                Seller.status == "active",
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="商品不存在或已下架")

    product, shop, seller = row
    skus = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(
                    ProductSku.tenant_id == tenant.id,
                    ProductSku.product_id == product.id,
                    ProductSku.status == "active",
                )
                .order_by(ProductSku.id)
            )
        ).all()
    )
    payload = _product_public_dict(product, shop, seller, skus[0] if skus else None)
    payload["skus"] = [
        {
            "id": sku.id,
            "sku_code": sku.sku_code,
            "name": sku.name,
            "price_cents": sku.price_cents,
            "stock": sku.stock,
            # 多规格选择器要靠这两个字段反查组合与切图
            "specs": sku.specs or {},
            "image_url": sku.image_url,
            "video_url": sku.video_url,
        }
        for sku in skus
    ]
    payload["spec_groups"] = await catalog_specs.load_spec_groups(db, product.id)

    # 富文本描述：只给详情（列表不需要，白増传输体积）。
    # html 已经是保存时 nh3 清洗过的，前端再走一层 DOMPurify 作纵深防御。
    payload["description_format"] = product.description_format or "text"
    payload["description_html"] = product.description_html
    # 老商品仍是纯文本，兵底给它
    payload["description"] = product.description

    # ---- 店铺信息卡（详情页右侧）要的数据 ----
    # 头像用**店铺 logo**（users 表没有头像字段）；
    # 用户名取卖家 owner（买家侧只展示 username，不展示 usr_ 编号）；
    # 全站名称取租户品牌名；`seller_id` 用于点「在线客服」时建 IM 会话。
    owner = (
        await db.scalars(select(User).where(User.id == seller.owner_user_id))
    ).first()
    payload["shop_logo"] = shop.logo
    payload["shop_description"] = shop.description
    payload["seller_username"] = owner.username if owner else None
    payload["tenant_name"] = tenant.display_name or tenant.name
    prices = [sku.price_cents for sku in skus]
    payload["price_min_cents"] = min(prices) if prices else None
    payload["price_max_cents"] = max(prices) if prices else None

    # —— 浏览计数：原子自增，计数交给数据库，不靠应用层读-改-写 ——
    await db.execute(
        update(Product)
        .where(Product.id == product.id)
        .values(view_count=Product.view_count + 1)
    )
    await db.commit()

    stats = await catalog_stats.stats_for(
        db, tenant_id=tenant.id, product_id=product.id
    )
    # 统计是提交之后读的，view_count 已经含本次访问，不再额外 +1
    payload.update(stats.as_dict())

    # 收藏态：匿名访问永远是 false；token 无效也当匿名（get_optional_context）
    payload["is_favorited"] = False
    if viewer_id:
        payload["is_favorited"] = bool(
            await db.scalar(
                select(func.count(ProductFavorite.id)).where(
                    ProductFavorite.tenant_id == tenant.id,
                    ProductFavorite.user_id == viewer_id,
                    ProductFavorite.product_id == product.id,
                )
            )
        )
    return payload

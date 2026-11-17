"""支付接口：发起真实支付、回调、主动查询。

回调路径是**公开**的（渠道服务器直接打过来，没有登录态），安全边界靠：
* 支付宝：RSA2 验签（用租户配置里的支付宝公钥）
* 微信：平台证书验签 + APIv3 密钥解密
* 两者都再核对**金额**与 `out_trade_no` 里的租户
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_permission
from app.core.response import ok
from app.models.order import Order
from app.services import payment as payment_service
from app.services.auth import AuthContext
from app.services.payment.config import PaymentConfigError, missing_fields

router = APIRouter(tags=["支付"])
public_router = APIRouter(prefix="/public/payments", tags=["支付回调"])


async def _load_own_order(db: AsyncSession, context: AuthContext, order_id: int) -> Order:
    order = await db.get(Order, order_id)
    if (
        order is None
        or order.tenant_id != context.tenant.id
        or order.buyer_id != context.user.id
    ):
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


@router.post("/portal/orders/{order_id}/payments")
async def create_payment(
    order_id: int,
    payload: dict,
    context: AuthContext = Depends(require_permission("order:read:self")),
    db: AsyncSession = Depends(get_db),
):
    """发起真实支付。

    返回 `{type: 'redirect', url}`（支付宝）或 `{type: 'qrcode', code_url}`（微信 Native）。
    渠道没配好时返回 400 并**列出缺哪些字段** —— 不能让运营对着 500 猜。
    """
    order = await _load_own_order(db, context, order_id)
    provider = str(payload.get("provider") or "").strip()
    result = await payment_service.create_payment(db, context, order, provider)
    return ok(result, "支付单已创建")


@router.post("/portal/orders/{order_id}/payments/query")
async def query_payment(
    order_id: int,
    payload: dict,
    context: AuthContext = Depends(require_permission("order:read:self")),
    db: AsyncSession = Depends(get_db),
):
    """主动查询渠道状态（回调丢了/用户付完没跳回来时兜底）。"""
    order = await _load_own_order(db, context, order_id)
    provider = str(payload.get("provider") or "").strip()
    return ok(await payment_service.query_and_sync(db, context, order, provider))


# ---------------------------------------------------------------- 回调


@public_router.post("/alipay/notify")
async def alipay_notify(request: Request, db: AsyncSession = Depends(get_db)):
    """支付宝异步通知：必须返回**裸文本 `success`**，否则会一直重发。"""
    form = {key: str(value) for key, value in (await request.form()).items()}
    result = await payment_service.handle_alipay_notify(db, form)
    return PlainTextResponse(result)


@public_router.get("/alipay/return")
async def alipay_return(request: Request, db: AsyncSession = Depends(get_db)):
    """支付宝同步跳回（用户浏览器）。这里只做"回前台结果页"，**不置状态**。

    状态只认异步通知/主动查询 —— 同步跳回可以被用户手动改参数，不能作为支付凭证。
    """
    params = dict(request.query_params)
    out_trade_no = params.get("out_trade_no", "")
    order, tenant_id = await payment_service._find_order_by_out_trade_no(db, out_trade_no)
    settings_row = None
    if tenant_id is not None:
        from app.services import setting as setting_service

        settings_row = await setting_service.get_setting(db, "payment", tenant_id)
    return_url = ""
    if settings_row is not None:
        return_url = str(
            ((settings_row.config or {}).get("alipay") or {}).get("returnUrl") or ""
        )
    if not return_url:
        return RedirectResponse(url="/portal/orders", status_code=302)
    if order is not None:
        joiner = "&" if "?" in return_url else "?"
        return_url = f"{return_url}{joiner}orderId={order.id}"
    return RedirectResponse(url=return_url, status_code=302)


@public_router.post("/wechat/notify")
async def wechat_notify(request: Request, db: AsyncSession = Depends(get_db)):
    """微信支付 V3 回调：验签 + 解密后才置已支付。"""
    body = (await request.body()).decode("utf-8")
    headers = {key.lower(): value for key, value in request.headers.items()}
    result = await payment_service.handle_wechat_notify(db, headers, body)
    return JSONResponse(result)


# ---------------------------------------------------------------- 配置自检


@router.get("/admin/settings/payment/health")
async def payment_health(
    context: AuthContext = Depends(require_permission("setting:payment")),
    db: AsyncSession = Depends(get_db),
):
    """支付配置自检：告诉运营每个渠道**还缺什么**、当前是沙箱还是生产。

    不做"测试连接"（支付宝/微信都没有安全的 ping 接口，真下单才算验证），
    但把必填项与网关环境暴露出来，能挡掉绝大多数配一半就上线的情况。
    """
    from app.services import setting as setting_service

    row = await setting_service.get_setting(db, "payment", context.tenant.id)
    config = row.config or {}
    alipay_raw = config.get("alipay") or {}
    wechat_raw = config.get("wechat") or {}
    return ok(
        {
            "enabled": row.enabled,
            "alipay": {
                "enabled": bool(alipay_raw.get("enabled", True)),
                "environment": alipay_raw.get("environment") or "sandbox",
                "missing": missing_fields(
                    alipay_raw, ("appId", "privateKey", "publicKey", "notifyUrl")
                ),
            },
            "wechat": {
                "enabled": bool(wechat_raw.get("enabled", True)),
                "missing": missing_fields(
                    wechat_raw,
                    ("mchId", "appId", "apiV3Key", "serialNo", "privateKey", "notifyUrl"),
                ),
            },
        }
    )

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class TenantNotificationPref(Base, TimestampMixin):
    """租户的渠道开关。

    `inbox`（站内信）是**强制开启**的：欠费、安全、合规类通知必须送达，
    所以不允许出现在这张表的可关闭集合里 —— 只能关短信/邮件。
    """

    __tablename__ = "tenant_notification_prefs"
    __table_args__ = (UniqueConstraint("tenant_id", "channel", name="uq_tenant_notification_pref"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    channel: Mapped[str] = mapped_column(String(16))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class UserNotificationPref(Base, TimestampMixin):
    """用户自己的通知偏好：**分类 × 渠道**。

    三层优先级（发送时逐层收窄，缺一行就沿用上一层的结论）：

    1. 渠道是否配置可用 —— `setting_resolver`（平台/租户配置继承）；
    2. 租户渠道开关 —— `tenant_notification_prefs`（运营决定这家站发不发短信）；
    3. 用户偏好 —— 本表（这个人愿不愿意收）。

    站内信（inbox）不在本表可关集合里：它承载欠费、安全、合规类通知，
    和租户级开关保持同一条约定 —— 只能关短信/邮件。

    只存「关掉」的行也可以，但读的时候要按「缺行 = 默认开启」解释，
    这样新增分类不需要给每个用户回填一遍。
    """

    __tablename__ = "user_notification_prefs"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "user_id", "category", "channel", name="uq_user_notification_pref"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    category: Mapped[str] = mapped_column(String(32))
    channel: Mapped[str] = mapped_column(String(16))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

from pydantic import BaseModel, Field


class TenantBrandOut(BaseModel):
    tenant_id: int
    slug: str
    name: str
    display_name: str
    # 一句话站点介绍（多行文本）；空表示租户没填，前端不显示
    site_description: str | None = None
    logo_url: str | None = None
    favicon_url: str | None = None
    # 页脚备案信息：ICP 备案号（如 京ICP备12345678号）与 ICP 许可证号（如 京ICP证…）
    icp_number: str | None = None
    icp_license: str | None = None


class TenantBrandUpdate(BaseModel):
    """租户维护自己的站点品牌。平台可覆盖（后续在平台端做）。

    没有主题色：全站配色跟随控制台主题（antd token），按租户自定义颜色会和
    深色模式 / 组件库色板冲突，产品上不提供这个开关。
    """

    display_name: str | None = Field(default=None, max_length=64)
    # 多行文本；上限 300 字（库里是 Text，不设硬截断，长度只在接口层卡）
    site_description: str | None = Field(default=None, max_length=300)
    logo_url: str | None = Field(default=None, max_length=512)
    favicon_url: str | None = Field(default=None, max_length=512)
    icp_number: str | None = Field(default=None, max_length=64)
    icp_license: str | None = Field(default=None, max_length=64)

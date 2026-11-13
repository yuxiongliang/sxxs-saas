from pydantic import BaseModel, Field

# 抽佣比例用万分比：100 = 1%，上限不设（平台可配），下限 1% 由商品侧兜。
BPS = Field(default=0, ge=0, le=100_000)


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    slug: str = Field(min_length=1, max_length=64, pattern="^[a-z0-9-]+$")
    sort: int = Field(default=0, ge=0)
    status: str = Field(default="active", pattern="^(active|archived)$")
    default_commission_bps: int = BPS


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    slug: str | None = Field(default=None, min_length=1, max_length=64, pattern="^[a-z0-9-]+$")
    sort: int | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^(active|archived)$")
    default_commission_bps: int | None = Field(default=None, ge=0, le=100_000)


class CategoryOut(BaseModel):
    id: int
    name: str
    slug: str
    sort: int
    status: str
    default_commission_bps: int
    product_count: int = 0

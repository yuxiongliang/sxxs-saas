"""商品所在地 / 距离（LBS）的唯一口径。

三条原则：

1. **坐标不出服务端**：公开接口（列表/详情/确认页）只返回算好的 `distance_m`，
   不返回卖家的精确经纬度。公开接口一旦带坐标，等于把所有卖家位置挂到网上可爬。
2. **直线距离**（haversine，地球半径 6371km）。不做驾车/步行距离——
   那要调高德路径规划，慢且吃配额，而"离我多远"用直线已经够。
3. **排序与展示同一公式**：SQL 里算距离用于 `ORDER BY` / 半径过滤，
   Python 里用同一套 haversine 算 `distance_m` 展示；否则会出现
   "列表按 A 排序、卡片显示 B 距离"的错位。
"""

from __future__ import annotations

import math
from decimal import Decimal

from sqlalchemy import func

#: 地球平均半径（米）
EARTH_RADIUS_M = 6_371_000.0

#: 半径筛选允许的最大值（公里），防止有人传 99999 把全库拉出来
MAX_RADIUS_KM = 500


def valid_coords(latitude: object, longitude: object) -> bool:
    try:
        lat = float(latitude)  # type: ignore[arg-type]
        lng = float(longitude)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点直线距离（米）。坐标顺序统一为 (lat, lng)。"""
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lng1, lat2, lng2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, a)))


def distance_sql(latitude_col, longitude_col, buyer_lat: float, buyer_lng: float):
    """SQL 侧同口径的 haversine（单位：米），用于排序与半径过滤。

    数据库没有 haversine 函数（也没装 PostGIS），这里用标准公式展开：
    2R · asin(√(sin²(Δφ/2) + cosφ1·cosφ2·sin²(Δλ/2)))
    任意一行缺坐标 → NULL（排序时 NULLS LAST，半径过滤时自然排除）。
    """
    lat_rad = func.radians(latitude_col)
    buyer_lat_rad = math.radians(buyer_lat)
    dlat = func.radians(latitude_col - buyer_lat)
    dlng = func.radians(longitude_col - buyer_lng)
    a = func.power(func.sin(dlat / 2), 2) + math.cos(buyer_lat_rad) * func.cos(
        lat_rad
    ) * func.power(func.sin(dlng / 2), 2)
    return 2 * EARTH_RADIUS_M * func.asin(func.sqrt(func.least(a, 1.0)))


def distance_between(
    product_lat: Decimal | float | None,
    product_lng: Decimal | float | None,
    buyer_lat: float | None,
    buyer_lng: float | None,
) -> int | None:
    """展示用距离（米，取整）。任一侧没坐标就返回 None —— 不猜、不伪造。"""
    if buyer_lat is None or buyer_lng is None:
        return None
    if product_lat is None or product_lng is None:
        return None
    return int(
        round(
            haversine_m(
                float(product_lat), float(product_lng), buyer_lat, buyer_lng
            )
        )
    )


def location_summary(
    province: str | None, city: str | None, district: str | None
) -> str | None:
    """买家侧展示用的地名（不要详细门牌：那属于卖家地址）。"""
    parts = [part for part in (province, city, district) if part]
    return " ".join(parts) if parts else None


def parse_radius_km(value: float | None) -> float | None:
    if value is None:
        return None
    if value <= 0:
        return None
    return min(float(value), MAX_RADIUS_KM)

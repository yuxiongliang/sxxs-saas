"""高德 POI 搜索（地址输入框的周边可选地点）。

守的契约：

1. POI 结果只给前端必要字段（name/address/location/省市区），**不含 key**；
2. 高德失败（没配 key / 配额 / 网络）时接口返回**空列表**而不是 500 ——
   联想失败不该挡住卖家填地址；
3. `location` 是 "lng,lat"（经度在前），前端拆开写纬度/经度时不要搞反。
"""

from __future__ import annotations

from app.services import amap as amap_module
from tests.conftest import bearer

PLACE_PAYLOAD = {
    "status": "1",
    "info": "OK",
    "pois": [
        {
            "name": "银苑小区",
            "address": "白云街道",
            "location": "121.420000,28.660000",
            "pname": "浙江省",
            "cityname": "台州市",
            "adname": "椒江区",
            "adcode": "331002",
        },
        # 高德偶尔会塞空 location 的条目：必须跳过，否则前端写进 NaN 坐标
        {"name": "没有坐标的点", "address": "", "location": []},
    ],
}


async def test_place_text_normalizes_payload(monkeypatch):
    async def fake_call(_key, _path, _params, _scope):
        return PLACE_PAYLOAD

    monkeypatch.setattr(amap_module, "_call", fake_call)
    rows = await amap_module.place_text("dummy-key", "银苑", "台州市")
    assert len(rows) == 1  # 空 location 的条目被跳过
    place = rows[0]
    assert place["name"] == "银苑小区"
    assert place["province"] == "浙江省"
    assert place["city"] == "台州市"
    assert place["district"] == "椒江区"
    assert place["location"] == "121.420000,28.660000"
    assert "key" not in place


async def test_amap_place_endpoint_passthrough(client, admin_token, monkeypatch):
    async def fake_place(_key, keywords, _city=""):
        assert keywords == "银苑"
        return [
            {
                "name": "银苑小区",
                "address": "白云街道",
                "location": "121.42,28.66",
                "province": "浙江省",
                "city": "台州市",
                "district": "椒江区",
                "adcode": "331002",
            }
        ]

    monkeypatch.setattr(amap_module, "place_text", fake_place)
    response = await client.get(
        "/api/v1/amap/place",
        headers=bearer(admin_token),
        params={"keywords": "银苑", "city": "台州市"},
    )
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert len(rows) == 1
    assert rows[0]["name"] == "银苑小区"
    assert "key" not in rows[0]


async def test_amap_place_degrades_to_empty_on_error(client, admin_token, monkeypatch):
    async def boom(*_args, **_kwargs):
        raise amap_module.AmapError("INVALID_USER_KEY", "10001", "place")

    monkeypatch.setattr(amap_module, "place_text", boom)
    response = await client.get(
        "/api/v1/amap/place",
        headers=bearer(admin_token),
        params={"keywords": "银苑"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"] == []


async def test_amap_place_requires_permission(client, customer_token):
    response = await client.get(
        "/api/v1/amap/place",
        headers=bearer(customer_token),
        params={"keywords": "银苑"},
    )
    assert response.status_code in (403, 401)

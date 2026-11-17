"""把 china-division 的 pca-code.json 规整成 省-市-区 三级树（去掉「市辖区」这种内部名）。

直辖市（北京/上海/天津/重庆）：原始数据是 省=北京市 → 市=市辖区 → 区=东城区，
直接给用户看"市辖区"很怪，这里把第二级替换成直辖市本身。
"""

import json
from pathlib import Path

src = json.loads(Path("/tmp/pca.json").read_text())
MUNICIPALITIES = {"北京市", "上海市", "天津市", "重庆市"}

tree = []
for province in src:
    cities = []
    for city in province.get("children") or []:
        districts = [
            {"name": item["name"]} for item in (city.get("children") or [])
        ]
        if city["name"] == "市辖区" and province["name"] in MUNICIPALITIES:
            cities.append({"name": province["name"], "children": districts})
        else:
            cities.append({"name": city["name"], "children": districts})
    tree.append({"name": province["name"], "children": cities})

# 港澳台：pca 数据集不含，手工补（二级到区/县，够收货地址用）
EXTRA = [
    {
        "name": "香港特别行政区",
        "children": [
            {
                "name": "香港特别行政区",
                "children": [
                    {"name": name}
                    for name in [
                        "中西区", "湾仔区", "东区", "南区", "油尖旺区", "深水埗区",
                        "九龙城区", "黄大仙区", "观塘区", "葵青区", "荃湾区", "屯门区",
                        "元朗区", "北区", "大埔区", "沙田区", "西贡区", "离岛区",
                    ]
                ],
            }
        ],
    },
    {
        "name": "澳门特别行政区",
        "children": [
            {
                "name": "澳门特别行政区",
                "children": [
                    {"name": name}
                    for name in [
                        "花地玛堂区", "圣安多尼堂区", "大堂区", "望德堂区",
                        "风顺堂区", "嘉模堂区", "圣方济各堂区", "路氹填海区",
                    ]
                ],
            }
        ],
    },
    {
        "name": "台湾省",
        "children": [
            {
                "name": "台湾省",
                "children": [
                    {"name": name}
                    for name in [
                        "台北市", "新北市", "桃园市", "台中市", "台南市", "高雄市",
                        "基隆市", "新竹市", "嘉义市", "新竹县", "苗栗县", "彰化县",
                        "南投县", "云林县", "嘉义县", "屏东县", "宜兰县", "花莲县",
                        "台东县", "澎湖县", "金门县", "连江县",
                    ]
                ],
            }
        ],
    },
]
tree.extend(EXTRA)

out = Path("app/data/regions.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(tree, ensure_ascii=False, separators=(",", ":")))

provinces = len(tree)
cities = sum(len(p["children"]) for p in tree)
districts = sum(len(c["children"]) for p in tree for c in p["children"])
print(f"provinces={provinces} cities={cities} districts={districts}")
print("北京样例:", json.dumps(tree[0]["children"][0], ensure_ascii=False)[:120])
print("末位省份:", tree[-1]["name"], [c["name"] for c in tree[-1]["children"]][:3])

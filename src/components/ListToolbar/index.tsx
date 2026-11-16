import { ReloadOutlined } from '@ant-design/icons';
import { Button, Input, Space } from 'antd';
import React from 'react';

interface ListToolbarProps {
  /** 搜索框占位文案（写清楚能搜什么，例如「商品名 / 卖家用户名」） */
  searchPlaceholder: string;
  keyword: string;
  onKeywordChange: (value: string) => void;
  /** 额外的筛选控件（Select / DatePicker…），按页面传入 */
  filters?: React.ReactNode;
  onRefresh?: () => void;
  /** 右侧附加操作（如「新建」按钮） */
  extra?: React.ReactNode;
}

/**
 * 列表页统一的「搜索 + 筛选 + 刷新」工具栏。
 *
 * 各页面原来各写一套，位置与宽度都不一致；抽出来保证全站观感一致。
 * 搜索用的是受控 `Input.Search`（回车/点放大镜才触发回调），避免每敲一个字打一次接口。
 */
const ListToolbar: React.FC<ListToolbarProps> = ({
  searchPlaceholder,
  keyword,
  onKeywordChange,
  filters,
  onRefresh,
  extra,
}) => (
  <Space wrap size={12} style={{ marginBottom: 16, width: '100%' }}>
    <Input.Search
      allowClear
      placeholder={searchPlaceholder}
      style={{ width: 280 }}
      defaultValue={keyword}
      onSearch={(value) => onKeywordChange(value.trim())}
    />
    {filters}
    {onRefresh ? (
      <Button icon={<ReloadOutlined />} onClick={onRefresh}>
        刷新
      </Button>
    ) : null}
    {extra}
  </Space>
);

export default ListToolbar;

import { TagsOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';
import ListToolbar from '@/components/ListToolbar';
import { listAdminCategories } from '@/services/commerce/api';
import type { CategoryRecord } from '@/services/commerce/types';
import SettingPage from '../../system/components/SettingPage';

const bpsToPercent = (bps: number) =>
  `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`;

/**
 * 商品分类（只读）。
 *
 * 分类由**平台**统一维护（一级），租户只能给商品选分类、不能自建 —— 否则每家租户一套分类，
 * 平台的抽佣口径与跨租户统计会全部碎片化。分类上的默认抽佣比例决定
 * 「租户向卖家抽多少」的默认值（卖家可在商品上单独改）。
 */
const ProductCategoriesPage: React.FC = () => {
  const [keyword, setKeyword] = useState('');
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-categories', keyword],
    queryFn: () => listAdminCategories({ keyword: keyword || undefined }),
  });

  const columns: ColumnsType<CategoryRecord> = [
    { title: '分类名称', dataIndex: 'name', width: 200 },
    {
      title: '标识',
      dataIndex: 'slug',
      width: 160,
      render: (value: string) => (
        <Typography.Text code>{value}</Typography.Text>
      ),
    },
    {
      title: '默认抽佣比例',
      dataIndex: 'default_commission_bps',
      width: 160,
      render: (value: number) => <Tag color="blue">{bpsToPercent(value)}</Tag>,
    },
    { title: '商品数', dataIndex: 'product_count', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) =>
        value === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
  ];

  return (
    <SettingPage
      title="商品分类"
      subTitle="分类由平台统一维护，这里只能查看与选择；分类上的默认抽佣比例用于卖家商品"
      icon={<TagsOutlined />}
    >
      <Card>
        <ListToolbar
          searchPlaceholder="搜分类名称 / 标识"
          keyword={keyword}
          onKeywordChange={setKeyword}
          onRefresh={() => refetch()}
        />
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={data ?? []}
          pagination={false}
        />
      </Card>
    </SettingPage>
  );
};

export default ProductCategoriesPage;

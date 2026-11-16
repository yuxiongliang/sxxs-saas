import { ReloadOutlined, ShopOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';
import ListToolbar from '@/components/ListToolbar';
import { listAdminSellers, reviewSeller } from '@/services/commerce/api';
import type { SellerRecord } from '@/services/commerce/types';
import { KYC_STATUS, labelOf, SELLER_STATUS } from '@/utils/labels';
import SettingPage from '../../system/components/SettingPage';

const statusColor = (status: string) =>
  status === 'active' ? 'success' : status === 'pending' ? 'gold' : 'default';

const SELLER_TYPE_LABEL: Record<string, string> = {
  individual: '个人',
  company: '企业',
};

const SellerManagementPage: React.FC = () => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>();
  const [sellerType, setSellerType] = useState<string>();
  const [kycStatus, setKycStatus] = useState<string>();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-sellers', keyword, status, sellerType, kycStatus],
    queryFn: () =>
      listAdminSellers({
        keyword: keyword || undefined,
        status,
        seller_type: sellerType,
        kyc_status: kycStatus,
      }),
  });

  const columns: ColumnsType<SellerRecord> = [
    {
      title: '用户ID',
      dataIndex: 'owner_public_id',
      width: 220,
      render: (value: string | null) =>
        value ? (
          <Typography.Text code copyable={{ text: value }}>
            {value}
          </Typography.Text>
        ) : (
          '—'
        ),
    },
    {
      title: '用户名',
      dataIndex: 'owner_username',
      width: 140,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '卖家名',
      dataIndex: 'display_name',
      render: (_, record) => (
        <Space>
          <ShopOutlined style={{ color: '#1677ff' }} />
          <span style={{ fontWeight: 600 }}>{record.display_name}</span>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'seller_type',
      width: 100,
      render: (value: string) => SELLER_TYPE_LABEL[value] ?? value,
    },
    {
      title: 'KYC',
      dataIndex: 'kyc_status',
      render: (value: string) => (
        <Tag color={value === 'approved' ? 'success' : 'gold'}>
          {labelOf(KYC_STATUS, value)}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: string) => (
        <Tag color={statusColor(value)}>{labelOf(SELLER_STATUS, value)}</Tag>
      ),
    },
    {
      title: '操作',
      width: 180,
      render: (_, record) =>
        record.status === 'pending' || record.kyc_status !== 'approved' ? (
          <Popconfirm
            title="通过卖家入驻审核？"
            onConfirm={async () => {
              await reviewSeller(record.id, {
                status: 'active',
                kyc_status: 'approved',
              });
              message.success('卖家审核通过');
              refetch();
            }}
          >
            <Button type="link" size="small">
              通过审核
            </Button>
          </Popconfirm>
        ) : record.status === 'active' ? (
          <Popconfirm
            title="确定停用该卖家？"
            onConfirm={async () => {
              await reviewSeller(record.id, {
                status: 'suspended',
                kyc_status: record.kyc_status,
              });
              message.success('卖家已停用');
              refetch();
            }}
          >
            <Button type="link" size="small" danger>
              停用
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <SettingPage
      title="卖家管理"
      subTitle="C2C 卖家入驻、KYC 与店铺状态"
      icon={<ShopOutlined />}
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
          刷新
        </Button>
      }
    >
      <Card>
        <ListToolbar
          searchPlaceholder="搜用户名 / 用户ID / 卖家名"
          keyword={keyword}
          onKeywordChange={setKeyword}
          onRefresh={() => refetch()}
          filters={
            <>
              <Select
                allowClear
                placeholder="状态"
                style={{ width: 130 }}
                value={status}
                onChange={setStatus}
                options={[
                  { label: '待审核', value: 'pending' },
                  { label: '正常', value: 'active' },
                  { label: '已停用', value: 'suspended' },
                  { label: '已关闭', value: 'closed' },
                ]}
              />
              <Select
                allowClear
                placeholder="类型"
                style={{ width: 120 }}
                value={sellerType}
                onChange={setSellerType}
                options={[
                  { label: '个人', value: 'individual' },
                  { label: '企业', value: 'company' },
                ]}
              />
              <Select
                allowClear
                placeholder="KYC"
                style={{ width: 130 }}
                value={kycStatus}
                onChange={setKycStatus}
                options={[
                  { label: '未提交', value: 'none' },
                  { label: '审核中', value: 'pending' },
                  { label: '已通过', value: 'approved' },
                  { label: '已驳回', value: 'rejected' },
                ]}
              />
            </>
          }
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

export default SellerManagementPage;

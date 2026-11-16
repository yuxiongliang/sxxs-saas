import { PlusOutlined, ShopOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';
import MediaField from '@/components/MediaField';
import ProductFavoriteTable from '@/components/ProductFavoriteTable';
import ProductReviewTable from '@/components/ProductReviewTable';
import PortalShell from '@/pages/portal/components/PortalShell';
import {
  applySeller,
  changeSellerProductStatus,
  createSellerProduct,
  getSellerApplication,
  getSellerProfile,
  listSellerFavorites,
  listSellerOrders,
  listSellerProducts,
  listSellerReviews,
  replySellerReview,
  requestSellerPayout,
  shipMySellerOrder,
  updateSellerProduct,
} from '@/services/commerce/api';
import type {
  ReviewRecord,
  SellerOrderRecord,
  SellerProductRecord,
} from '@/services/commerce/types';
import { labelOf, PRODUCT_STATUS } from '@/utils/labels';

const SellerPage: React.FC = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [productOpen, setProductOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<SellerProductRecord>();
  const [editForm] = Form.useForm();
  const [shipOpen, setShipOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SellerOrderRecord>();
  const applicationQuery = useQuery({
    queryKey: ['seller-application'],
    queryFn: getSellerApplication,
    retry: false,
  });
  const application = applicationQuery.data;
  const [shopName, setShopName] = useState('');
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    if (shopName.trim().length < 2) {
      message.error('店铺名至少 2 个字');
      return;
    }
    setApplying(true);
    try {
      await applySeller({ shop_name: shopName.trim() });
      message.success('申请已提交，等待平台审核');
      await queryClient.invalidateQueries({ queryKey: ['seller-application'] });
    } catch (error: any) {
      message.error(error?.message || '申请失败');
    } finally {
      setApplying(false);
    }
  };
  const [productForm] = Form.useForm();
  const [shipForm] = Form.useForm();
  // 商品收藏 / 我的评价：卖家只能看自己店铺的，关键词搜索走服务端
  const [favoriteKeyword, setFavoriteKeyword] = useState<string>();
  const [reviewKeyword, setReviewKeyword] = useState<string>();
  const [replyingReview, setReplyingReview] = useState<ReviewRecord>();
  const [reviewReply, setReviewReply] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['seller-profile'],
    queryFn: getSellerProfile,
  });
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['seller-products'],
    queryFn: listSellerProducts,
  });
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['seller-orders'],
    queryFn: listSellerOrders,
  });
  const sellerFavorites = useQuery({
    queryKey: ['seller-favorites', favoriteKeyword],
    queryFn: () => listSellerFavorites({ keyword: favoriteKeyword }),
  });
  const sellerReviews = useQuery({
    queryKey: ['seller-reviews', reviewKeyword],
    queryFn: () => listSellerReviews({ keyword: reviewKeyword }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['seller-favorites'] });
    queryClient.invalidateQueries({ queryKey: ['seller-reviews'] });
    queryClient.invalidateQueries({ queryKey: ['seller-products'] });
    queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
  };

  const handleCreateProduct = async () => {
    const values = await productForm.validateFields();
    await createSellerProduct({
      name: values.name,
      price_cents: Math.round(values.price * 100),
      stock: values.stock,
      main_image: values.main_image || undefined,
      video_url: values.video_url || undefined,
    });
    message.success('商品已提交审核');
    setProductOpen(false);
    productForm.resetFields();
    refresh();
  };

  const handleShip = async () => {
    if (!selectedOrder) return;
    const values = await shipForm.validateFields();
    await shipMySellerOrder(selectedOrder.id, values);
    message.success('发货成功');
    setShipOpen(false);
    shipForm.resetFields();
    refresh();
  };

  const handlePayout = async () => {
    try {
      const payout = await requestSellerPayout();
      message.success(`结算成功：¥${(payout.amount_cents / 100).toFixed(2)}`);
      refresh();
    } catch (error: any) {
      message.error(error?.message || '结算失败');
    }
  };

  const openEdit = (record: SellerProductRecord) => {
    setEditing(record);
    editForm.setFieldsValue({
      name: record.name,
      description: record.description ?? '',
      main_image: record.main_image ?? '',
      video_url: record.video_url ?? '',
      price_yuan: record.price_cents / 100,
      stock: record.stock,
      commission_percent:
        record.commission_bps === null || record.commission_bps === undefined
          ? undefined
          : record.commission_bps / 100,
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      const result = await updateSellerProduct(editing.id, {
        name: values.name,
        description: values.description,
        main_image: values.main_image || undefined,
        video_url: values.video_url || undefined,
        price_cents: Math.round(Number(values.price_yuan) * 100),
        stock: Number(values.stock),
        ...(typeof values.commission_percent === 'number'
          ? { commission_bps: Math.round(values.commission_percent * 100) }
          : {}),
      });
      if (result.bounced_to_review) {
        message.info('在售商品改动后已自动重新提交审核');
      } else {
        message.success('商品已更新');
      }
      setEditOpen(false);
      refresh();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || '更新失败');
    }
  };

  const changeStatus = async (
    record: SellerProductRecord,
    status: 'off_sale' | 'pending_review',
  ) => {
    try {
      await changeSellerProductStatus(record.id, status);
      message.success(status === 'off_sale' ? '商品已下架' : '已重新提交审核');
      refresh();
    } catch (error: any) {
      message.error(error?.message || '操作失败');
    }
  };

  const productColumns: ColumnsType<SellerProductRecord> = [
    {
      title: '商品',
      dataIndex: 'name',
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.name}</div>
          {record.reject_reason ? (
            <div style={{ color: '#cf1322', fontSize: 12 }}>
              驳回原因：{record.reject_reason}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => <Tag>{labelOf(PRODUCT_STATUS, v)}</Tag>,
    },
    {
      title: '价格',
      dataIndex: 'price_cents',
      width: 110,
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    { title: '库存', dataIndex: 'stock', width: 90 },
    { title: '销量', dataIndex: 'sold_count', width: 80 },
    { title: '浏览', dataIndex: 'view_count', width: 80 },
    { title: '收藏', dataIndex: 'favorite_count', width: 80 },
    {
      title: '评分',
      key: 'rating',
      width: 110,
      render: (_, record) =>
        record.rating_avg == null
          ? '—'
          : `★ ${record.rating_avg.toFixed(1)}（${record.review_count ?? 0}）`,
    },
    {
      title: '操作',
      width: 200,
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          {record.status === 'on_sale' ? (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => changeStatus(record, 'off_sale')}
            >
              下架
            </Button>
          ) : null}
          {['rejected', 'draft', 'off_sale'].includes(record.status) ? (
            <Button
              type="link"
              size="small"
              onClick={() => changeStatus(record, 'pending_review')}
            >
              重新提交审核
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const orderColumns: ColumnsType<SellerOrderRecord> = [
    { title: '卖家单号', dataIndex: 'seller_order_no' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '商品金额',
      dataIndex: 'goods_amount_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    {
      title: '佣金',
      dataIndex: 'commission_amount_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    {
      title: '应结算',
      dataIndex: 'payable_to_seller_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) =>
        ['paid', 'processing'].includes(record.status) ? (
          <Button
            type="link"
            size="small"
            onClick={() => {
              setSelectedOrder(record);
              setShipOpen(true);
            }}
          >
            发货
          </Button>
        ) : null,
    },
  ];

  if (applicationQuery.isLoading) {
    return (
      <PortalShell>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 48 }}>
          加载中…
        </div>
      </PortalShell>
    );
  }

  if (!application?.has_seller) {
    return (
      <PortalShell>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
          <Card title="申请成为店主">
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Typography.Text type="secondary">
                你目前是买家。开一家自己的店即可在同一套页面里管理商品、订单与结算，无需切换入口。
              </Typography.Text>
              <Input
                placeholder="店铺名称（例如：阿强的二手键盘铺）"
                value={shopName}
                onChange={(event) => setShopName(event.target.value)}
                maxLength={64}
              />
              <Button type="primary" loading={applying} onClick={handleApply}>
                提交开店申请
              </Button>
            </Space>
          </Card>
        </div>
      </PortalShell>
    );
  }

  if (application.status === 'pending') {
    return (
      <PortalShell>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
          <Alert
            type="info"
            showIcon
            title="开店申请审核中"
            description="平台审核通过后，这里会变成你的店铺管理页（商品 / 订单 / 结算）。"
          />
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        <Card style={{ marginBottom: 16 }}>
          <Space
            orientation="vertical"
            size={4}
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                <ShopOutlined /> {profile?.display_name || '卖家'}
              </Typography.Title>
              <Typography.Text type="secondary">
                店铺：{profile?.shop?.name || '-'} · KYC：
                {profile?.kyc_status || '-'} · 状态：{profile?.status || '-'}
              </Typography.Text>
            </div>
            <Button onClick={handlePayout}>申请结算</Button>
          </Space>
        </Card>
        <Card>
          <Tabs
            items={[
              {
                key: 'products',
                label: '我的商品',
                children: (
                  <>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      style={{ marginBottom: 16 }}
                      onClick={() => setProductOpen(true)}
                    >
                      新增商品
                    </Button>
                    <Table
                      rowKey="id"
                      loading={productsLoading}
                      columns={productColumns}
                      dataSource={products ?? []}
                      pagination={false}
                    />
                  </>
                ),
              },
              {
                key: 'orders',
                label: '我的订单',
                children: (
                  <Table
                    rowKey="id"
                    loading={ordersLoading}
                    columns={orderColumns}
                    dataSource={orders ?? []}
                    pagination={false}
                  />
                ),
              },
              {
                key: 'favorites',
                label: '商品收藏',
                children: (
                  <>
                    <Input.Search
                      allowClear
                      placeholder="搜商品名 / 用户名 / 用户ID"
                      style={{ width: 300, marginBottom: 16 }}
                      onSearch={(value) =>
                        setFavoriteKeyword(value.trim() || undefined)
                      }
                    />
                    <ProductFavoriteTable
                      data={sellerFavorites.data ?? []}
                      loading={sellerFavorites.isLoading}
                    />
                  </>
                ),
              },
              {
                key: 'reviews',
                label: '我的评价',
                children: (
                  <>
                    <Input.Search
                      allowClear
                      placeholder="搜商品名 / 用户名 / 评价内容"
                      style={{ width: 300, marginBottom: 16 }}
                      onSearch={(value) =>
                        setReviewKeyword(value.trim() || undefined)
                      }
                    />
                    {/* 卖家只能回复，不能隐藏（canModerate 不传） */}
                    <ProductReviewTable
                      data={sellerReviews.data ?? []}
                      loading={sellerReviews.isLoading}
                      canReply
                      onReply={(record) => {
                        setReplyingReview(record);
                        setReviewReply(record.reply ?? '');
                      }}
                    />
                  </>
                ),
              },
            ]}
          />
        </Card>

        {/* 回复评价：卖家只能回复，隐藏是运营/平台的权力 */}
        <Modal
          title="回复评价"
          open={Boolean(replyingReview)}
          onCancel={() => setReplyingReview(undefined)}
          onOk={async () => {
            if (!replyingReview) return;
            if (!reviewReply.trim()) {
              message.warning('回复内容不能为空');
              return;
            }
            await replySellerReview(replyingReview.id, reviewReply.trim());
            message.success('已回复');
            setReplyingReview(undefined);
            setReviewReply('');
            queryClient.invalidateQueries({ queryKey: ['seller-reviews'] });
          }}
          okText="提交回复"
        >
          <Input.TextArea
            rows={4}
            maxLength={1000}
            showCount
            value={reviewReply}
            onChange={(event) => setReviewReply(event.target.value)}
            placeholder="例如：抱歉让您不满意，已私信您处理方案"
          />
        </Modal>

        <Modal
          title="新增商品"
          open={productOpen}
          onCancel={() => setProductOpen(false)}
          onOk={handleCreateProduct}
          destroyOnHidden
        >
          <Form form={productForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              label="商品名称"
              name="name"
              rules={[{ required: true, message: '请输入商品名称' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="价格（元）"
              name="price"
              rules={[{ required: true, message: '请输入价格' }]}
            >
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="库存"
              name="stock"
              rules={[{ required: true, message: '请输入库存' }]}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            {/* 卖家新建商品也必须能传主图，否则前台只有占位图 */}
            <Form.Item label="商品主图" name="main_image">
              <MediaField kind="image" title="选择商品主图" boxSize={96} />
            </Form.Item>
            <Form.Item label="商品视频（可选）" name="video_url">
              <MediaField kind="video" title="选择商品视频" boxSize={96} />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="卖家发货"
          open={shipOpen}
          onCancel={() => setShipOpen(false)}
          onOk={handleShip}
          destroyOnHidden
        >
          <Form form={shipForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              label="物流公司"
              name="carrier"
              rules={[{ required: true, message: '请输入物流公司' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="运单号"
              name="tracking_no"
              rules={[{ required: true, message: '请输入运单号' }]}
            >
              <Input />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="编辑商品"
          open={editOpen}
          onCancel={() => setEditOpen(false)}
          onOk={handleEditSave}
          destroyOnHidden
          forceRender
        >
          <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              label="商品名称"
              name="name"
              rules={[{ required: true, message: '请输入商品名称' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label="商品描述" name="description">
              <Input.TextArea rows={3} placeholder="成色、规格、卖点" />
            </Form.Item>
            <Form.Item label="商品主图" name="main_image">
              <MediaField kind="image" title="选择商品主图" boxSize={96} />
            </Form.Item>
            <Form.Item label="商品视频（可选）" name="video_url">
              <MediaField kind="video" title="选择商品视频" boxSize={96} />
            </Form.Item>
            <Form.Item
              label="价格（元）"
              name="price_yuan"
              rules={[{ required: true, message: '请输入价格' }]}
            >
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="库存"
              name="stock"
              rules={[{ required: true, message: '请输入库存' }]}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="佣金比例（%）"
              name="commission_percent"
              extra={
                editing?.commission_locked
                  ? '已被运营调整并锁定，暂不可修改；有异议请联系运营'
                  : '平台按这个比例从成交额里抽佣；留空则用分类默认比例（下限 1%）'
              }
              rules={[{ type: 'number', min: 1, message: '最低 1%' }]}
            >
              <InputNumber
                min={1}
                max={100}
                step={0.5}
                style={{ width: '100%' }}
                disabled={Boolean(editing?.commission_locked)}
              />
            </Form.Item>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              在售商品改了内容或价格会自动重新进入审核，审核通过后恢复在售。
            </Typography.Text>
          </Form>
        </Modal>
      </div>
    </PortalShell>
  );
};

export default SellerPage;

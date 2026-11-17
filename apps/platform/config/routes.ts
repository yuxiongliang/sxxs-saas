export default [
  {
    path: '/login',
    layout: false,
    component: './login',
  },
  { path: '/', redirect: '/tenants/list' },
  {
    // 租户管理：租户列表 / 套餐 / 服务类目
    // 套餐原在「计费」下，挪进来之后旧链接 /billing/plans 仍会跳过来
    path: '/tenants',
    name: 'tenantManage',
    icon: 'ClusterOutlined',
    routes: [
      { path: '/tenants', redirect: '/tenants/list' },
      {
        path: '/tenants/list',
        name: 'tenantList',
        component: './tenants',
      },
      {
        path: '/tenants/plans',
        name: 'tenantPlans',
        component: './billing/plans',
      },
      {
        path: '/tenants/categories',
        name: 'serviceCategories',
        component: './tenants/categories',
      },
    ],
  },
  {
    path: '/users',
    name: 'platformUsers',
    icon: 'TeamOutlined',
    component: './users',
  },
  {
    // 总部财务：下面分「SAAS 财务」（账单 / 抽佣台账）
    path: '/billing',
    name: 'billing',
    icon: 'WalletOutlined',
    routes: [
      { path: '/billing', redirect: '/billing/saas/invoices' },
      // 旧链接兼容
      { path: '/billing/plans', redirect: '/tenants/plans' },
      { path: '/billing/invoices', redirect: '/billing/saas/invoices' },
      { path: '/billing/commission', redirect: '/billing/saas/commission' },
      {
        path: '/billing/saas',
        name: 'billingSaas',
        routes: [
          { path: '/billing/saas', redirect: '/billing/saas/invoices' },
          {
            path: '/billing/saas/invoices',
            name: 'billingInvoices',
            component: './billing/invoices',
          },
          {
            path: '/billing/saas/commission',
            name: 'billingCommission',
            component: './billing/commission',
          },
        ],
      },
    ],
  },
  // 租户概览已合并进租户列表，旧链接仍可用
  { path: '/overview', redirect: '/tenants/list' },
  {
    path: '/audit',
    name: 'audit',
    icon: 'SafetyCertificateOutlined',
    component: './audit',
  },
  {
    // 延时任务队列：自动收货倒计时等。平台运维要能看计划、手动执行、取消、重试
    path: '/jobs',
    name: 'jobs',
    icon: 'ClockCircleOutlined',
    component: './jobs',
  },
  {
    path: '/notifications',
    name: 'notifications',
    icon: 'NotificationOutlined',
    component: './notifications',
  },
  {
    path: '/services',
    name: 'services',
    icon: 'SettingOutlined',
    component: './services',
  },
  {
    path: '/moderation',
    name: 'moderation',
    icon: 'SafetyOutlined',
    component: './moderation',
  },
  {
    // 商品分类与「租户分类」(/tenants/categories) 不是一回事：前者是商品目录，
    // 后者是租户的业务类目（决定平台向租户抽佣）。分开挂，避免侧边栏两个「分类」。
    path: '/catalog',
    name: 'catalog',
    icon: 'TagsOutlined',
    routes: [
      { path: '/catalog', redirect: '/catalog/products' },
      {
        // 全站商品总览：跨租户只读，带销量/浏览/收藏/评分
        path: '/catalog/products',
        name: 'platformProducts',
        component: './catalog/products',
      },
      {
        path: '/catalog/categories',
        name: 'productCategories',
        component: './catalog/categories',
      },
      {
        // 全站收藏：谁收藏了哪个商品
        path: '/catalog/favorites',
        name: 'platformFavorites',
        component: './catalog/favorites',
      },
      {
        // 全站评价：抽查隐藏 / 回复
        path: '/catalog/reviews',
        name: 'platformReviews',
        component: './catalog/reviews',
      },
    ],
  },
  {
    path: '/settings',
    name: 'settings',
    icon: 'SettingOutlined',
    routes: [
      { path: '/settings', redirect: '/settings/platform' },
      {
        path: '/settings/platform',
        name: 'platformSetting',
        component: './settings',
      },
      {
        path: '/settings/upload',
        name: 'uploadSetting',
        component: './settings/upload',
      },
    ],
  },
];

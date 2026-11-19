/**
 * @name umi 的路由配置
 * @description 只支持 path,component,routes,redirect,wrappers,name,icon 的配置
 * @param path  path 只支持两种占位符配置，第一种是动态参数 :id 的形式，第二种是 * 通配符，通配符只能出现路由字符串的最后。
 * @param component 配置 location 和 path 匹配后用于渲染的 React 组件路径。可以是绝对路径，也可以是相对路径，如果是相对路径，会从 src/pages 开始找起。
 * @param routes 配置子路由，通常在需要为多个路径增加 layout 组件时使用。
 * @param redirect 配置路由跳转
 * @param wrappers 配置路由组件的包装组件，通过包装组件可以为当前的路由组件组合进更多的功能。 比如，可以用于路由级别的权限校验
 * @param name 配置路由的标题，默认读取国际化文件 menu.ts 中 menu.xxxx 的值，如配置 name 为 login，则读取 menu.ts 中 menu.login 的取值作为标题
 * @param icon 配置路由的图标，取值参考 https://ant.design/components/icon-cn， 注意去除风格后缀和大小写，如想要配置图标为 <StepBackwardOutlined /> 则取值应为 stepBackward 或 StepBackward，如想要配置图标为 <UserOutlined /> 则取值应为 user 或者 User
 * @doc https://umijs.org/docs/guides/routes
 */
export default [
  {
    path: '/user',
    layout: false,
    routes: [
      {
        path: '/user/login',
        name: 'login',
        component: './user/login',
      },
      {
        path: '/user',
        redirect: '/user/login',
      },
      {
        name: 'register-result',
        icon: 'checkCircle',
        path: '/user/register-result',
        component: './user/register-result',
      },
      {
        name: 'register',
        icon: 'userAdd',
        path: '/user/register',
        component: './user/register',
      },
      {
        name: '404',
        component: './exception/404',
        path: '/user/*',
      },
    ],
  },
  {
    path: '/welcome',
    name: 'welcome',
    icon: 'home',
    component: './Welcome',
  },
  {
    path: '/admin',
    name: 'admin',
    icon: 'crown',
    access: 'canAdmin',
    routes: [
      {
        path: '/admin',
        redirect: '/admin/sub-page',
      },
      {
        path: '/admin/sub-page',
        name: 'sub-page',
        component: './Admin',
      },
    ],
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    icon: 'dashboard',
    routes: [
      {
        path: '/dashboard',
        redirect: '/dashboard/analysis',
      },
      {
        name: 'analysis',
        icon: 'barChart',
        path: '/dashboard/analysis',
        component: './dashboard/analysis',
      },
      {
        name: 'workplace',
        icon: 'desktop',
        path: '/dashboard/workplace',
        component: './dashboard/workplace',
      },
    ],
  },
  {
    path: '/form',
    icon: 'form',
    name: 'form',
    routes: [
      {
        path: '/form',
        redirect: '/form/basic-form',
      },
      {
        name: 'basic-form',
        icon: 'form',
        path: '/form/basic-form',
        component: './form/basic-form',
      },
      {
        name: 'step-form',
        icon: 'orderedList',
        path: '/form/step-form',
        component: './form/step-form',
      },
      {
        name: 'advanced-form',
        icon: 'profile',
        path: '/form/advanced-form',
        component: './form/advanced-form',
      },
    ],
  },
  {
    path: '/list',
    icon: 'table',
    name: 'list',
    routes: [
      {
        path: '/list/search',
        name: 'search-list',
        component: './list/search',
        routes: [
          {
            path: '/list/search',
            redirect: '/list/search/articles',
          },
          {
            name: 'articles',
            icon: 'read',
            path: '/list/search/articles',
            component: './list/search/articles',
          },
          {
            name: 'projects',
            icon: 'project',
            path: '/list/search/projects',
            component: './list/search/projects',
          },
          {
            name: 'applications',
            icon: 'appstore',
            path: '/list/search/applications',
            component: './list/search/applications',
          },
        ],
      },
      {
        path: '/list',
        redirect: '/list/table-list',
      },
      {
        name: 'table-list',
        icon: 'table',
        path: '/list/table-list',
        component: './table-list',
      },
      {
        name: 'basic-list',
        icon: 'unorderedList',
        path: '/list/basic-list',
        component: './list/basic-list',
      },
      {
        name: 'card-list',
        icon: 'creditCard',
        path: '/list/card-list',
        component: './list/card-list',
      },
    ],
  },
  {
    path: '/profile',
    name: 'profile',
    icon: 'profile',
    routes: [
      {
        path: '/profile',
        redirect: '/profile/basic',
      },
      {
        name: 'basic',
        icon: 'idcard',
        path: '/profile/basic',
        component: './profile/basic',
      },
      {
        name: 'advanced',
        icon: 'crown',
        path: '/profile/advanced',
        component: './profile/advanced',
      },
    ],
  },
  {
    name: 'result',
    icon: 'checkCircle',
    path: '/result',
    routes: [
      {
        path: '/result',
        redirect: '/result/success',
      },
      {
        name: 'success',
        icon: 'checkCircle',
        path: '/result/success',
        component: './result/success',
      },
      {
        name: 'fail',
        icon: 'closeCircle',
        path: '/result/fail',
        component: './result/fail',
      },
    ],
  },
  {
    name: 'exception',
    icon: 'warning',
    path: '/exception',
    routes: [
      {
        path: '/exception',
        redirect: '/exception/403',
      },
      {
        name: '403',
        icon: 'stop',
        path: '/exception/403',
        component: './exception/403',
      },
      {
        name: '404',
        icon: 'warning',
        path: '/exception/404',
        component: './exception/404',
      },
      {
        name: '500',
        icon: 'bug',
        path: '/exception/500',
        component: './exception/500',
      },
    ],
  },
  {
    name: 'account',
    icon: 'user',
    path: '/account',
    routes: [
      {
        path: '/account',
        // `center` 仍是模板演示页（文章/应用/项目全是 mock 假数据），
        // 个人设置才是真实页面 —— 默认落点改成它，别再让人先撞到假页。
        redirect: '/account/settings',
      },
      {
        name: 'center',
        icon: 'user',
        path: '/account/center',
        component: './account/center',
      },
      {
        name: 'settings',
        icon: 'setting',
        path: '/account/settings',
        component: './account/settings',
      },
    ],
  },
  {
    path: '/system/audit',
    name: 'audit-log',
    icon: 'audit',
    access: 'canAuditRead',
    component: './system/audit',
  },
  {
    path: '/finance',
    name: 'finance-management',
    icon: 'accountBook',
    // Needs the 'finance' plan feature as well as payout:read.
    access: 'canUseFinance',
    component: './commerce/finance',
  },
  {
    path: '/messages',
    name: 'message-center',
    icon: 'message',
    // Needs the 'im' plan feature as well as im:conversation:read.
    access: 'canUseIm',
    component: './im',
  },
  {
    path: '/sellers',
    name: 'seller-management',
    icon: 'shop',
    access: 'canSellerRead',
    component: './commerce/sellers',
  },
  {
    // 租户控制台的商品管理。**不能用 `/products`**：那是公开商城商品列表（layout:false），
    // 两个路由抢同一个 path 时必有一边不可达，且 `/products` 在 PUBLIC_PATHS 里，
    // 会被当成免登录页。
    path: '/commerce/products',
    name: 'product-management',
    icon: 'shopping',
    access: 'canProductManage',
    routes: [
      { path: '/commerce/products', redirect: '/commerce/products/list' },
      {
        path: '/commerce/products/list',
        name: 'productList',
        icon: 'unorderedList',
        access: 'canProductManage',
        component: './commerce/products',
      },
      {
        // 编辑商品改成独立页面（弹窗塞 5 步表单太挤），不进菜单
        path: '/commerce/products/:id/edit',
        access: 'canProductManage',
        component: './commerce/products/edit',
        hideInMenu: true,
      },
      {
        // 分类是平台定的，租户只能看/选；放这里只是让运营知道商品能归哪几类
        path: '/commerce/products/categories',
        name: 'productCategories',
        icon: 'tags',
        access: 'canProductManage',
        component: './commerce/products/categories',
      },
      {
        // 谁收藏了哪个商品（买家行为侧）
        path: '/commerce/products/favorites',
        name: 'productFavorites',
        icon: 'star',
        access: 'canProductManage',
        component: './commerce/products/favorites',
      },
      {
        // 评价管理：隐藏/回复需要 product:moderate，页面进来看用 product:manage
        path: '/commerce/products/reviews',
        name: 'productReviews',
        icon: 'message',
        access: 'canProductManage',
        component: './commerce/products/reviews',
      },
    ],
  },
  {
    // 资金审核：卖家结算申请 + 用户钱包提现，运营在一处审钱
    path: '/commerce/finance/withdrawals',
    component: './commerce/finance/withdrawals',
  },
  {
    path: '/orders',
    name: 'order-management',
    icon: 'profile',
    access: 'canOrderReadTenant',
    component: './commerce/orders',
  },
  {
    path: '/users',
    name: 'user-management',
    icon: 'team',
    access: 'canUserRead',
    routes: [
      {
        path: '/users',
        redirect: '/users/list',
      },
      {
        path: '/users/list',
        name: 'list',
        icon: 'unorderedList',
        access: 'canUserRead',
        component: './system/users',
      },
      {
        // 部门管理已下线（产品上用不到）：老书签/文档里的链接不返回 404，直接回到用户列表
        path: '/users/departments',
        redirect: '/users/list',
      },
      {
        path: '/users/roles',
        name: 'roles',
        icon: 'safetyCertificate',
        access: 'canRoleManage',
        component: './system/users/roles',
      },
    ],
  },
  {
    path: '/system/settings',
    name: 'system-settings',
    icon: 'setting',
    access: 'canSettings',
    routes: [
      {
        // 默认落在「基础设置」下的站点品牌：分组排第一，默认项也要跟着走
        path: '/system/settings',
        redirect: '/system/settings/basic/brand',
      },
      {
        path: '/system/settings/basic',
        name: 'basic-settings',
        icon: 'control',
        access: 'canSettings',
        routes: [
          {
            path: '/system/settings/basic',
            redirect: '/system/settings/basic/brand',
          },
          {
            // 注意：子路由必须以上级路径开头，所以品牌页从 /system/brand 迁到这里；
            // 旧地址下面用一条 redirect 兜住，历史链接不会 404
            path: '/system/settings/basic/brand',
            name: 'brand',
            icon: 'picture',
            access: 'canBrandManage',
            component: './system/brand',
          },
          {
            path: '/system/settings/basic/time-control',
            name: 'time-control',
            icon: 'fieldTime',
            access: 'canTimeControl',
            component: './system/settings/time-control',
          },
        ],
      },
      {
        path: '/system/settings/payment',
        name: 'payment',
        icon: 'payCircle',
        access: 'canPaymentSetting',
        component: './system/settings/payment',
      },
      {
        path: '/system/settings/sms',
        name: 'sms',
        icon: 'message',
        access: 'canSmsSetting',
        component: './system/settings/sms',
      },
      {
        path: '/system/settings/email',
        name: 'email',
        icon: 'mail',
        access: 'canEmailSetting',
        component: './system/settings/email',
      },
      {
        path: '/system/settings/storage',
        name: 'storage',
        icon: 'cloudServer',
        access: 'canStorageSetting',
        component: './system/settings/storage',
      },
      {
        path: '/system/settings/amap',
        name: 'amap',
        icon: 'environment',
        access: 'canAmapSetting',
        component: './system/settings/amap',
      },
    ],
  },
  {
    // 兼容旧地址：站点品牌搬进「系统设置 → 基础设置」后，外部链接与收藏仍能打开
    path: '/system/brand',
    redirect: '/system/settings/basic/brand',
  },
  {
    path: '/attachments',
    name: 'attachment-management',
    icon: 'paperClip',
    access: 'canAttachmentRead',
    component: './system/attachments',
  },
  {
    path: '/notifications',
    name: 'notification-center',
    icon: 'notification',
    access: 'canNotificationRead',
    component: './system/notifications',
  },
  {
    path: '/chatbot',
    name: 'chatbot',
    icon: 'robot',
    component: './chatbot',
  },
  {
    path: '/portal',
    layout: false,
    component: './portal',
  },
  {
    path: '/products',
    layout: false,
    component: './products',
  },
  {
    path: '/products/:id',
    layout: false,
    component: './products/detail',
  },
  // 商品详情已迁到站点前台；旧链接保留重定向，避免收藏/外链 404
  {
    path: '/portal/products/:id',
    layout: false,
    redirect: '/products/:id',
  },
  {
    path: '/portal/orders',
    layout: false,
    component: './portal/orders',
  },
  {
    // 买家订单详情页已下线：收货/物流/备注都直接展示在列表里，旧链接回列表
    path: '/portal/orders/:id',
    layout: false,
    redirect: '/portal/orders',
  },
  {
    path: '/portal/cart',
    layout: false,
    component: './portal/cart',
  },
  {
    path: '/portal/addresses',
    layout: false,
    component: './portal/addresses',
  },
  {
    // 我的收藏（买家）：与详情页的星标共用同一套接口
    path: '/portal/favorites',
    layout: false,
    component: './portal/favorites',
  },
  {
    // 订单确认页（独立页面）：立即购买 与 购物车结算 都走这里，弹窗已下线
    path: '/portal/checkout',
    layout: false,
    component: './portal/checkout',
  },
  {
    // 我的钱包（买家/卖家同一个钱包；按租户隔离）
    path: '/portal/wallet',
    layout: false,
    component: './portal/wallet',
  },
  {
    // 消息（买家）：与卖家即时沟通
    path: '/portal/messages',
    layout: false,
    component: './portal/messages',
  },
  {
    // 我的评价（买家）：待评价 + 已评价
    path: '/portal/reviews',
    layout: false,
    component: './portal/reviews',
  },
  {
    path: '/portal/payment-result',
    layout: false,
    component: './portal/payment-result',
  },
  {
    path: '/portal/seller',
    layout: false,
    component: './portal/seller',
  },
  // 卖家中心：从原来的单页 Tabs 拆成真实子页面（侧栏要高亮/可深链）
  {
    path: '/portal/seller/shop',
    layout: false,
    component: './portal/seller/shop',
  },
  {
    path: '/portal/seller/products/create',
    layout: false,
    component: './portal/seller/products/create',
  },
  {
    path: '/portal/seller/products/:id/edit',
    layout: false,
    component: './portal/seller/products/edit',
  },
  {
    path: '/portal/seller/products',
    layout: false,
    component: './portal/seller/products',
  },
  {
    path: '/portal/seller/orders',
    layout: false,
    component: './portal/seller/orders',
  },
  {
    path: '/portal/seller/favorites',
    layout: false,
    component: './portal/seller/favorites',
  },
  {
    path: '/portal/seller/reviews',
    layout: false,
    component: './portal/seller/reviews',
  },
  {
    path: '/portal/seller/messages',
    layout: false,
    component: './portal/seller/messages',
  },
  // 旧链接兼容：店主中心已并入买家外壳（同一个入口，不再单独一个端口）
  {
    path: '/seller',
    layout: false,
    redirect: '/portal/seller',
  },
  // 站点根 = 全新商城首页（公开）：导航为 首页 / 商品 / 赛霄玄思
  {
    path: '/',
    layout: false,
    component: './home',
  },
  // 原赛霄玄思产品介绍页（营销落地页），由新首页的「赛霄玄思」入口进入
  {
    path: '/site',
    layout: false,
    component: './site',
  },
  {
    component: './exception/404',
    path: '/*',
  },
];

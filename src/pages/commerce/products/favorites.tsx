import { useQuery } from '@tanstack/react-query';
import { Card } from 'antd';
import { useState } from 'react';
import ListToolbar from '@/components/ListToolbar';
import ProductFavoriteTable from '@/components/ProductFavoriteTable';
import SettingPage from '@/pages/system/components/SettingPage';
import { listAdminFavorites } from '@/services/commerce/api';

/**
 * 商品收藏（运营视角）。
 *
 * 回答的问题就一个：**谁收藏了哪个商品**。所以「收藏用户」列必须是
 * 用户ID + 用户名，而不是把商品信息堆一列了事。
 */
export default function ProductFavoritesPage() {
  const [keyword, setKeyword] = useState<string>();

  const favorites = useQuery({
    queryKey: ['admin-favorites', keyword],
    queryFn: () => listAdminFavorites({ keyword }),
  });

  return (
    <SettingPage
      title="商品收藏"
      subTitle="买家收藏了哪些商品；收藏量是商品受欢迎程度的直接信号"
      icon={<span>★</span>}
    >
      <Card>
        <ListToolbar
          searchPlaceholder="搜商品名 / 用户名 / 用户ID / 店铺名"
          keyword={keyword ?? ''}
          onKeywordChange={(value) => setKeyword(value || undefined)}
          onRefresh={() => favorites.refetch()}
        />
        <ProductFavoriteTable
          data={favorites.data ?? []}
          loading={favorites.isLoading}
        />
      </Card>
    </SettingPage>
  );
}

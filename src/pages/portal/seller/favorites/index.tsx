import { useQuery } from '@tanstack/react-query';
import { Card, Input } from 'antd';
import { useState } from 'react';
import ProductFavoriteTable from '@/components/ProductFavoriteTable';
import { listSellerFavorites } from '@/services/commerce/api';
import SellerShell from '../components/SellerShell';

/** 商品收藏（卖家侧）：只看自己店铺商品被谁收藏。 */
export default function SellerFavoritesPage() {
  const [keyword, setKeyword] = useState<string>();
  const favorites = useQuery({
    queryKey: ['seller-favorites', keyword],
    queryFn: () => listSellerFavorites({ keyword }),
  });

  return (
    <SellerShell title="商品收藏">
      <Card>
        <Input.Search
          allowClear
          placeholder="搜商品名 / 用户名 / 用户ID"
          style={{ width: 300, marginBottom: 16 }}
          onSearch={(value) => setKeyword(value.trim() || undefined)}
        />
        <ProductFavoriteTable
          data={favorites.data ?? []}
          loading={favorites.isLoading}
        />
      </Card>
    </SellerShell>
  );
}

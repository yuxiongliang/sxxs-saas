import { useNavigate, useParams } from '@umijs/max';
import ProductWizard from '@/pages/commerce/products/components/ProductWizard';
import SellerShell from '../../components/SellerShell';
import { sellerAdapter } from '../sellerAdapter';

/** 卖家中心 · 编辑商品（独立页面） */
export default function SellerProductEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const backToList = () => navigate('/portal/seller/products');

  return (
    <SellerShell title="编辑商品">
      <ProductWizard
        productId={Number(id)}
        adapter={sellerAdapter}
        onCancel={backToList}
        onSaved={backToList}
      />
    </SellerShell>
  );
}

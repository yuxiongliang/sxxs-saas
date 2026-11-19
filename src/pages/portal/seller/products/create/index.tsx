import { useNavigate } from '@umijs/max';
import ProductWizard from '@/pages/commerce/products/components/ProductWizard';
import SellerShell from '../../components/SellerShell';
import { sellerAdapter } from '../sellerAdapter';

/** 卖家中心 · 新建商品（独立页面，与运营端同一套向导） */
export default function SellerProductCreatePage() {
  const navigate = useNavigate();
  const backToList = () => navigate('/portal/seller/products');

  return (
    <SellerShell title="新建商品">
      <ProductWizard
        mode="create"
        adapter={sellerAdapter}
        onCancel={backToList}
        onSaved={backToList}
      />
    </SellerShell>
  );
}

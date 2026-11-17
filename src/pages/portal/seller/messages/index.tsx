import ImChat from '@/components/ImChat';
import SellerShell from '../components/SellerShell';

/** 卖家中心 · 消息：与买家沟通；商品卡片只能发自己店铺的在售商品。 */
export default function SellerMessagesPage() {
  return (
    <SellerShell title="消息">
      <ImChat mode="seller" height={600} />
    </SellerShell>
  );
}

import ImChat from '@/components/ImChat';
import PortalShell from '../components/PortalShell';

/** 买家中心 · 消息：与卖家即时沟通（发消息/图片/视频/商品卡片，可搜索/撤回/编辑）。 */
export default function PortalMessagesPage() {
  return (
    <PortalShell title="消息">
      <ImChat mode="buyer" height={600} />
    </PortalShell>
  );
}

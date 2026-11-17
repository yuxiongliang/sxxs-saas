import { MessageOutlined } from '@ant-design/icons';
import ImChat from '@/components/ImChat';
import SettingPage from '../system/components/SettingPage';

/**
 * 控制台消息中心。
 *
 * 与买家中心 / 卖家中心的「消息」页**共用同一个 `ImChat` 组件** ——
 * 功能（图片/视频/商品卡片/搜索/撤回/编辑）只有一份实现，改一次三处同步。
 */
const ImPage: React.FC = () => (
  <SettingPage
    title="消息中心"
    subTitle="C2C 买卖家即时沟通"
    icon={<MessageOutlined />}
  >
    <ImChat mode="buyer" height={620} />
  </SettingPage>
);

export default ImPage;

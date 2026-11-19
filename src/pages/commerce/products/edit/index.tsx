import { useNavigate, useParams } from '@umijs/max';
import ProductWizard from '../components/ProductWizard';

/**
 * 运营端「编辑商品」—— 独立页面（原来是 960px 弹窗塞 5 步表单）。
 *
 * 弹窗的问题很具体：规格表格 + 富文本 + 图片选择三层嵌套，滚动冲突、
 * 校验出错要滚很远才能看到，而且一按 ESC 就全丢。
 */
export default function AdminProductEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const backToList = () => navigate('/commerce/products/list');

  return (
    <ProductWizard
      productId={Number(id)}
      onCancel={backToList}
      onSaved={backToList}
    />
  );
}

import type { ProductWizardAdapter } from '@/pages/commerce/products/components/ProductWizard';
import {
  createSellerProduct,
  getSellerProduct,
  listSellerCategories,
  saveSellerProductSpecs,
  updateSellerProduct,
} from '@/services/commerce/api';

/**
 * 卖家侧的向导适配器。
 *
 * 单独成文件的原因：列表页（新增/编辑入口）与新建页、编辑页都要用它，
 * 留在列表页里会变成三处各抄一份，"改一个接口漏一处"。
 */
export const sellerAdapter: ProductWizardAdapter = {
  load: getSellerProduct,
  categories: () => listSellerCategories(),
  saveBasic: async (id, payload) => {
    const body = payload as Parameters<typeof updateSellerProduct>[1];
    if (id) {
      const result = await updateSellerProduct(id, body);
      if (result.bounced_to_review) {
        // 由调用方的 message 提示，这里只回传
      }
      return id;
    }
    const created = await createSellerProduct(
      payload as Parameters<typeof createSellerProduct>[0],
    );
    return created.id;
  },
  saveSpecs: async (id, payload) => {
    await saveSellerProductSpecs(id, payload);
  },
  // 卖家没有佣金设置与解锁能力：showCommission 默认 false
};

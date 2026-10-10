import { defineStore } from 'pinia';
import { ref } from 'vue';
import { suppliersApi, type SupplierRow } from '@/api';

/**
 * 供应商的共享缓存。
 *
 * 下单登记、供应商页面反复用到，之前每开一次对话框就重拉一次；
 * 这里做进程内缓存 + 在途去重，写操作后由调用方 invalidate。
 */
export const useCatalogStore = defineStore('catalog', () => {
  const suppliers = ref<SupplierRow[]>([]);

  let suppliersPromise: Promise<SupplierRow[]> | null = null;
  let suppliersLoaded = false;

  async function ensureSuppliers(force = false): Promise<SupplierRow[]> {
    if (force) {
      suppliersLoaded = false;
      suppliersPromise = null;
    }
    if (suppliersLoaded) return suppliers.value;
    if (!suppliersPromise) {
      suppliersPromise = suppliersApi
        .list()
        .then((rows) => {
          suppliers.value = rows;
          suppliersLoaded = true;
          return rows;
        })
        .finally(() => {
          suppliersPromise = null;
        });
    }
    return suppliersPromise;
  }

  function invalidateSuppliers(): void {
    suppliersLoaded = false;
    suppliersPromise = null;
  }

  return {
    suppliers,
    ensureSuppliers,
    invalidateSuppliers,
  };
});

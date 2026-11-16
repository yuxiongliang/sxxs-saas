import { SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Empty, Input, Modal } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { SearchEntry, SearchGroup } from '../search';
import { groupEntries, resolveSafeHref, searchEntries } from '../search';
import useStyles from '../style';

/**
 * 全局搜索：本地命令面板。
 *
 * 用本地索引而不是后端检索 —— 落地页内容是可枚举的几十条，走网络只会
 * 增加延迟与失败面。⌘K / Ctrl+K 唤起，↑↓ 选择、Enter 打开、Esc 关闭。
 */
export default function GlobalSearch({ entries }: { entries: SearchEntry[] }) {
  const { styles } = useStyles();
  const { formatMessage } = useIntl();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const grouped = useMemo(
    () => groupEntries(searchEntries(entries, query)),
    [entries, query],
  );

  /**
   * 「在商品里搜索」这一条永远排最前。
   *
   * 全局搜索原本只索引导航项，用户搜「键盘」什么都搜不到 ——
   * 真正想找的是商品。这里把它接到列表页的筛选上（`/products?keyword=`）。
   */
  const productSearchEntry = useMemo<SearchEntry | null>(() => {
    const keyword = query.trim();
    if (!keyword) return null;
    return {
      id: 'search-products',
      group: 'nav',
      title: `在商品中搜索「${keyword}」`,
      desc: '按商品名 / 店铺 / 卖家搜索在售商品',
      href: `/products?keyword=${encodeURIComponent(keyword)}`,
    };
  }, [query]);

  const withProductSearch = useMemo<Array<[SearchGroup, SearchEntry[]]>>(() => {
    if (!productSearchEntry) return grouped;
    let found = false;
    const next = grouped.map(([group, items]) => {
      if (group !== 'nav')
        return [group, items] as [SearchGroup, SearchEntry[]];
      found = true;
      return [group, [productSearchEntry, ...items]] as [
        SearchGroup,
        SearchEntry[],
      ];
    });
    // 导航组一条都没命中时单独补一组，保证「在商品中搜索」总能看到
    return found ? next : [['nav', [productSearchEntry]], ...grouped];
  }, [grouped, productSearchEntry]);
  const flat = useMemo(
    () => withProductSearch.flatMap(([, items]) => items),
    [withProductSearch],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setActive(0);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  const go = (entry: SearchEntry) => {
    // 只跳同源锚点或站内路径，避免索引写错时变成开放重定向
    const target = resolveSafeHref(entry.href);
    if (!target) return;
    close();
    if (target.startsWith('#')) {
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    window.location.assign(target);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const target = flat[active];
      if (target) go(target);
    } else if (event.key === 'Escape') {
      close();
    }
  };

  let runningIndex = -1;

  return (
    <>
      <button
        type="button"
        className={styles.searchTrigger}
        onClick={() => setOpen(true)}
      >
        <SearchOutlined />
        <span>
          {formatMessage({
            id: 'site.search.placeholder',
            defaultMessage: '搜索功能、模块或文档…',
          })}
        </span>
        <kbd className={styles.kbd}>⌘K</kbd>
      </button>

      <Modal
        open={open}
        onCancel={close}
        footer={null}
        closable={false}
        width={640}
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        <div
          style={{ padding: 16, borderBottom: '1px solid rgba(0,0,0,0.06)' }}
        >
          <Input
            autoFocus
            size="large"
            variant="borderless"
            prefix={<SearchOutlined />}
            placeholder={formatMessage({
              id: 'site.search.placeholder',
              defaultMessage: '搜索功能、模块或文档…',
            })}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div style={{ maxHeight: 420, overflowY: 'auto', padding: 8 }}>
          {!query.trim() ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                opacity: 0.55,
                fontSize: 13,
              }}
            >
              {formatMessage({
                id: 'site.search.hint',
                defaultMessage: '↑↓ 选择 · Enter 打开 · Esc 关闭',
              })}
            </div>
          ) : flat.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={formatMessage({
                id: 'site.search.empty',
                defaultMessage: '没有匹配结果',
              })}
            />
          ) : (
            withProductSearch.map(([group, items]) => (
              <div key={group}>
                <div
                  style={{
                    padding: '8px 12px 4px',
                    fontSize: 12,
                    opacity: 0.55,
                  }}
                >
                  {formatMessage({
                    id: `site.search.group.${group}`,
                    defaultMessage: group,
                  })}
                </div>
                {items.map((entry) => {
                  runningIndex += 1;
                  const isActive = runningIndex === active;
                  return (
                    <div
                      key={entry.id}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={-1}
                      onMouseEnter={() => setActive(runningIndex)}
                      onClick={() => go(entry)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') go(entry);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        padding: '10px 12px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: isActive
                          ? 'rgba(22,119,255,0.10)'
                          : 'transparent',
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{entry.title}</span>
                      {entry.desc ? (
                        <span style={{ fontSize: 12, opacity: 0.6 }}>
                          {entry.desc}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}

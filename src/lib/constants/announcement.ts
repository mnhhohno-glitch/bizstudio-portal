export const ANNOUNCEMENT_CATEGORIES = {
  IMPORTANT:   { icon: '📌', label: '重要',         color: '#DC2626', bgColor: '#FEE2E2' },
  FEATURE:     { icon: '✨', label: '新機能',       color: '#2563EB', bgColor: '#DBEAFE' },
  FIX:         { icon: '🔧', label: '修正・改善',   color: '#D97706', bgColor: '#FEF3C7' },
  MAINTENANCE: { icon: '🛠️', label: 'メンテナンス', color: '#6B7280', bgColor: '#F3F4F6' },
  RELEASE:     { icon: '🎉', label: 'リリース',     color: '#16A34A', bgColor: '#DCFCE7' },
} as const;

export type AnnouncementCategoryKey = keyof typeof ANNOUNCEMENT_CATEGORIES;

export const ANNOUNCEMENT_STATUSES = {
  PUBLISHED: { label: '公開', color: '#16A34A', bgColor: '#DCFCE7' },
  DRAFT:     { label: '下書き', color: '#6B7280', bgColor: '#F3F4F6' },
} as const;

export type AnnouncementStatusKey = keyof typeof ANNOUNCEMENT_STATUSES;

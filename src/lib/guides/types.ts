export interface GuideFieldConfig {
  key: string;
  label: string;
  placeholder: string;
  rows?: number;
}

export interface GuideConfig {
  type: string;
  title: string;
  description: string;
  sections: {
    id: string;
    title: string;
    description?: string;
    fields: GuideFieldConfig[];
  }[];
}

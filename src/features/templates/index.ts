/** テンプレート機能の公開入口。画面側はここからだけ import する。 */

export { TemplateScreen, type TemplateScreenProps } from "./TemplateScreen";
export {
  BLANK_TEMPLATE,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  buildTemplateNodes,
  countNodes,
  describeTemplate,
  type Template,
  type TemplateCategory,
  type TemplateNode,
  type TemplatePreviewKind,
} from "./catalog";

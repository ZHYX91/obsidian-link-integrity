import { readFileSync } from "node:fs";
import path from "node:path";

const styles = readFileSync(path.resolve(import.meta.dirname, "../../styles.css"), "utf8");

/** Inspect authored declarations without coupling an assertion to their source order. */
export function styleDeclarations(selector: string): CSSStyleDeclaration {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  const rules = Array.from(sheet.cssRules).filter((candidate): candidate is CSSStyleRule =>
    candidate instanceof CSSStyleRule &&
    candidate.selectorText.split(",").some((value) => value.trim() === selector),
  );
  if (rules.length === 0) throw new Error(`Missing stylesheet rule: ${selector}`);
  const declarations = document.createElement("div").style;
  // The same selector may be split across base and shared-family rules. Keep
  // the CSS priority/order contract for each property, not its textual position.
  for (const { style } of rules) {
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item(index);
      const priority = style.getPropertyPriority(property);
      if (declarations.getPropertyPriority(property) === "important" && priority !== "important") continue;
      declarations.setProperty(property, style.getPropertyValue(property), priority);
    }
  }
  return declarations;
}

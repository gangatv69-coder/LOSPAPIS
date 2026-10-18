import ts from 'typescript';

/**
 * Atributos JSX cuyo valor ve el usuario (o el lector de pantalla).
 * Un string literal en cualquiera de ellos es texto sin traducir.
 */
export const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'title',
  'placeholder',
  'alt',
  'label',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
]);

/** Textos permitidos aunque contengan letras: marca, siglas, unidades... (ya recortados). */
export const ALLOWED_TEXTS: readonly (string | RegExp)[] = ['LOS PAPIS'];

export type Violation = {
  file: string;
  line: number;
  kind: 'jsx-text' | 'jsx-expression' | `attribute:${string}`;
  text: string;
};

const HTML_ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi;
const HAS_LETTER = /\p{L}/u;

/** ¿Es texto que un humano lee? Ignora símbolos, números y entidades. */
function isHumanText(raw: string): boolean {
  const text = raw.replace(HTML_ENTITY, '').trim();
  if (!HAS_LETTER.test(text)) return false;
  return !ALLOWED_TEXTS.some((allowed) =>
    typeof allowed === 'string' ? allowed === text : allowed.test(text),
  );
}

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Devuelve el texto literal de una expresión "simple", o null si no lo es. */
function literalText(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isTemplateExpression(expr)) {
    return [expr.head.text, ...expr.templateSpans.map((s) => s.literal.text)].join(' ');
  }
  if (ts.isParenthesizedExpression(expr)) {
    return literalText(expr.expression);
  }
  return null;
}

/**
 * Ramas de `cond ? "Sí" : "No"` y `valor ?? "N/D"` / `valor || "N/D"`.
 * No se baja más: dentro de llamadas (cn("flex ..."), map(...)) hay strings que no son texto de interfaz.
 */
function literalBranches(expr: ts.Expression): string[] {
  const direct = literalText(expr);
  if (direct !== null) return [direct];
  if (ts.isConditionalExpression(expr)) {
    return [...literalBranches(expr.whenTrue), ...literalBranches(expr.whenFalse)];
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...literalBranches(expr.left), ...literalBranches(expr.right)];
  }
  return [];
}

/** Analiza un archivo .tsx y devuelve los textos de interfaz escritos en el código. */
export function findHardcodedText(fileName: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const violations: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const raw = source.slice(node.pos, node.end);
      if (isHumanText(raw)) {
        violations.push({
          file: fileName,
          line: lineOf(sourceFile, node.pos + raw.search(/\S/)),
          kind: 'jsx-text',
          text: raw.trim(),
        });
      }
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const text of literalBranches(node.expression)) {
        if (isHumanText(text)) {
          violations.push({
            file: fileName,
            line: lineOf(sourceFile, node.getStart(sourceFile)),
            kind: 'jsx-expression',
            text: text.trim(),
          });
        }
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (TEXT_ATTRIBUTES.has(name) && node.initializer) {
        const expr = ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        for (const text of expr ? literalBranches(expr) : []) {
          if (isHumanText(text)) {
            violations.push({
              file: fileName,
              line: lineOf(sourceFile, node.getStart(sourceFile)),
              kind: `attribute:${name}`,
              text: text.trim(),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line}  [${v.kind}]  ${JSON.stringify(v.text)}`)
    .join('\n');
}

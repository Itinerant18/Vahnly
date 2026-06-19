// ts-jest "before" AST transformer: rewrite Vite's `import.meta` to `({ env: {} })`
// so config.ts (which reads import.meta.env.VITE_*) compiles and runs under Jest's
// CommonJS environment. Real values come from Vite at build/dev; tests just need the
// `?? ''` fallbacks, so an empty env is correct.
const ts = require('typescript');

module.exports.version = 1;
module.exports.name = 'import-meta-mock';
module.exports.factory = () => (context) => {
  const visit = (node) => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      return ts.factory.createParenthesizedExpression(
        ts.factory.createObjectLiteralExpression(
          [ts.factory.createPropertyAssignment('env', ts.factory.createObjectLiteralExpression([], false))],
          false,
        ),
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (sourceFile) => ts.visitNode(sourceFile, visit);
};

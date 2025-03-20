// This plugin will open a tab that indicates that it will monitor the current
// selection on the page. It cannot change the document itself.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__);

// Trads
// figma.variables.getLocalVariablesAsync().then(x => console.log(x.map(v => [v.name, v.codeSyntax, v])));

type VisitResult = {
  name: string;
  id: string;
  children: VisitResult[];
  css?: Record<string, string>;
  instanceOf?: { name: string; id: string; key: string };
};

const visit = async (node: SceneNode): Promise<VisitResult> => {
  const { type, name, id } = node;
  const props: Partial<VisitResult> = {};

  switch (type) {
    case 'INSTANCE': {
      props.css = await node.getCSSAsync();
      const component = await node.getMainComponentAsync();
      props.instanceOf = component ? { name: component.name, id: component.id, key: component.key } : undefined;
      break;
    }
    case 'COMPONENT':
      break;
    case 'COMPONENT_SET':
      break;
    case 'FRAME':
      props.css = await node.getCSSAsync();
      break;
    case 'TEXT':
      console.log('TEXT', node);
      break;
    case 'VECTOR':
      props.css = await node.getCSSAsync();
      return { name, id, children: [], ...props };
    default:
      console.log(type, name, node);
  }
  console.log(type, name, node, props);
  const children = 'children' in node ? (await Promise.all(node.children.map(visit))) : [];
  return { name, id, children, ...props };
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function display(res: VisitResult, level: number = 0) {
  console.log(`${'  '.repeat(level)}-${res.name}${res.css ? JSON.stringify(res.css) : ''}`);
  res.children.forEach(node => display(node, level + 1));
}

figma.on('selectionchange', async () => {
  // Selected node
  const result = [];
  for (const node of figma.currentPage.selection) {
    result.push(await visit(node));
  }
  // result.forEach(display);
});

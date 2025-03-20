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

type VisitResult = {name: string; id: string; css?: Record<string, string>, children: VisitResult[]};

const visit = async ({type, id, name, ...node}: SceneNode): Promise<VisitResult | undefined> => {
  const children = 'children' in node ? (await Promise.all(node.children.map(visit))).filter(x => x != null) : []
  // const css = await node.getCSSAsync();
  // const children = [] as VisitResult[];
  const css = {} as Record<string, string>;

  console.log(type, name, children, node, node.children);
  switch (type) {
    case 'INSTANCE':
      return { name, id, children, css }
    case 'COMPONENT':
      return { name, id, children, css }
    case 'COMPONENT_SET':
      return { name, id, children, css }
    case 'FRAME':
      return { name, id, children, css };
    case 'TEXT':
      console.log('TEXT', node);
      break;
    default:
      console.log(type, name, node);
  }
}

figma.on('selectionchange', async () => {
  // Selected node
  const result = [];
  for (const node of figma.currentPage.selection) {
    result.push(await visit(node));
  }
  console.log(result);
});

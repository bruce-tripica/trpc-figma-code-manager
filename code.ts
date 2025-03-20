// This plugin will open a tab that indicates that it will monitor the current
// selection on the page. It cannot change the document itself.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__);

// Trads
const localVariables = {} as Record<string, Variable>;
figma.variables.getLocalVariablesAsync().then(x => x.forEach(val => localVariables[val.id] = val));
const localCollectionVariables = {} as Record<string, VariableCollection>;
figma.variables.getLocalVariableCollectionsAsync().then(x => x.forEach(val => localCollectionVariables[val.id] = val));

type VisitResult = {
  name: string;
  id: string;
  children: VisitResult[];
  css?: Record<string, string>;
  instanceOf?: { name: string; id: string; key: string };
  propsValues?: Record<string, string>;
  props?: ComponentPropertyDefinitions;
  modes?: Record<string, string>;
};

const visit = async (node: SceneNode): Promise<VisitResult> => {
  const { type, name, id } = node;
  const props: Partial<VisitResult> = {};

  switch (type) {
    case 'INSTANCE': {
      console.log(node.componentProperties);

      props.css = await node.getCSSAsync();
      const component = await node.getMainComponentAsync();
      props.instanceOf = component ? { name: component.name, id: component.id, key: component.key } : undefined;
      break;
    }
    case 'COMPONENT':
      props.propsValues = node.variantProperties ?? undefined;
      props.modes = node.resolvedVariableModes;
      break;
    case 'COMPONENT_SET':
      props.props = node.componentPropertyDefinitions;
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

const getVariableById = async (id: string) => {
  const variable = await figma.variables.getVariableByIdAsync(id);
  return variable ? variableMapper(variable) : null;
};
const getVariableCollectionById = async (id: string) => {
  const collection = await figma.variables.getVariableCollectionByIdAsync(id);
  return collection ? variableCollectionMapper(collection) : null;
};

const variableValueMapper = async (variableValue: VariableValue) => {
  return typeof variableValue === 'object' && 'type' in variableValue && variableValue.type === 'VARIABLE_ALIAS'
    ? await getVariableById(variableValue.id)
    : variableValue;
};
const valuesByModeMapper = async (variableByMode: Record<string, VariableValue>) => {
  const variableValues = {} as Record<string, unknown>;
  for (const key in variableByMode) {
    variableValues[key] = await variableValueMapper(variableByMode[key]);
  }
  return variableValues;
};

const variableMapper = async (variable: Variable) => ({
  name: variable.name,
  description: variable.description,
  resolvedType: variable.resolvedType,
  values: await valuesByModeMapper(variable.valuesByMode),
  zzRaw: variable,
});

const variableCollectionMapper = async (collection: VariableCollection) => ({
  name: collection.name,
  modes: collection.modes,
  variables: await Promise.all(collection.variableIds.map(getVariableById)),
  zzRaw: collection,
});

const debugVariables = async () => {
  const node = figma.currentPage.selection[0];
  const result = [];
  for (const id in node.resolvedVariableModes) {
    result.push(await getVariableCollectionById(id));
  }
  console.log(result);
};

figma.ui.onmessage = async (message) => {
  if (message === 'debug') {
    await debugVariables();
  }
};
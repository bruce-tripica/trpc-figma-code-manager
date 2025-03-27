// This plugin will open a tab that indicates that it will monitor the current
// selection on the page. It cannot change the document itself.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__);

const INDENT = '  ';

type VisitResult = {
  name: string;
  id: string;
  children: VisitResult[];
  css?: Record<string, string>;
  instanceOf?: { name: string; id: string; key: string; zzRaw: ComponentNode };
  propsValues?: Record<string, string>;
  props?: ComponentPropertyDefinitions;
  modes?: Record<string, string>;
};

const visit = async (node: SceneNode): Promise<VisitResult> => {
  const { type, name, id } = node;
  const props: Partial<VisitResult> = {};

  let nodeChildren = 'children' in node ? node.children : [];

  switch (type) {
    case 'INSTANCE': {
      props.css = await node.getCSSAsync();
      const component = await node.getMainComponentAsync();
      props.instanceOf = component ? {
        name: component.name,
        id: component.id,
        key: component.key,
        zzRaw: component,
      } : undefined;
      props.propsValues = node.variantProperties ?? undefined;
      break;
    }
    case 'COMPONENT':
      props.propsValues = node.variantProperties ?? undefined;
      props.modes = node.resolvedVariableModes;
      break;
    case 'COMPONENT_SET':
      props.props = node.componentPropertyDefinitions;
      nodeChildren = [nodeChildren[0]];
      break;
    case 'FRAME':
      props.css = await node.getCSSAsync();
      break;
    case 'TEXT':
      break;
    case 'VECTOR':
      props.css = await node.getCSSAsync();
      return { name, id, children: [], ...props };
    default:
      console.warn(`unknown type ${type}`);
  }
  const children: VisitResult[] = [];
  for (const child of nodeChildren) {
    children.push(await visit(child));
  }
  return { name, id, children, ...props };
};

const generateHtml = async () => {
  const result = [];
  for (const node of figma.currentPage.selection) {
    result.push(await visit(node));
  }
  return result;
};

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
  for (const id in (node?.resolvedVariableModes ?? {})) {
    result.push(await getVariableCollectionById(id));
  }
  console.log(result);
};

function display(res: VisitResult, level: number = 0) {
  console.log(`${'  '.repeat(level)}-${res.name}${res.css ? JSON.stringify(res.css) : ''}`);
  res.children.forEach(node => display(node, level + 1));
}

const getNodePropertyDefinitions = (node: ComponentNode | ComponentSetNode): ComponentPropertyDefinitions | undefined => {
  try {
    return node.componentPropertyDefinitions;
  } catch {
    console.error(`The component ${node.name} doesn't have props`, node);
    return undefined;
  }
};

type ReactNodeTree = {
  type: string;
  css?: Record<string, string>;
  children?: (ReactNodeTree | string)[];
}

type ReactNode = {
  name: string;
  props: ComponentPropertyDefinitions;
  tree: ReactNodeTree;
}

const convertNodeTreeToReact = async (node: SceneNode): Promise<ReactNodeTree> => {
  switch (node.type) {
    case 'COMPONENT': {
      const children = [];
      for (const child of node.children) children.push(await convertNodeTreeToReact(child));
      return { type: 'Box', css: await node.getCSSAsync(), children }
    }
    case 'INSTANCE': {
      return { type: node.name, css: await node.getCSSAsync() };
    }
    case 'TEXT': {
      return { type: 'Typography', css: await node.getCSSAsync(), children: [node.characters]}
    }
  }
  return { type: node.type, css: {}, children: [] };
}

const convertNodeToReact = async (componentSet?: BaseNode | null): Promise<ReactNode | void> => {
  if (componentSet?.type !== 'COMPONENT_SET') return figma.ui.postMessage({
    type: 'error',
    message: 'Need to select a ComponentSet!',
  });
  const firstVariant = componentSet.children[0];
  if (firstVariant.type !== 'COMPONENT') return figma.ui.postMessage({
    type: 'error',
    message: 'The first node in the ComponentSet is not a Component variant',
  });
  const instanceNode = firstVariant.children.find(node => node.type === 'INSTANCE');
  if (!instanceNode) return figma.ui.postMessage({ type: 'error', message: 'No instance node in the Component' });
  const component = await instanceNode.getMainComponentAsync();
  if (!component) return figma.ui.postMessage({ type: 'error', message: 'Cannot retrieve main component!' });

  const componentSetProps = getNodePropertyDefinitions(componentSet);
  let componentProps = getNodePropertyDefinitions(component);
  if (!componentProps) {
    const reactComponent = await convertNodeToReact(component.parent);
    if (reactComponent) {
      componentProps = reactComponent.props;
    }
  }
  const props = { ...componentSetProps, ...componentProps };
  return { name: componentSet.name, props, tree: await convertNodeTreeToReact(component) };
};

const formatReactComponentName = (initialName: string) => {
  let name = initialName;
  name = name.replace(/\s/g, '');
  name = name[0].toUpperCase() + name.substring(1);
  return name;
};
const formatPropertyName = (initialName: string) => {
  let name = initialName;
  name = name.replace(/#.*/, '');
  name = name.replace(/\s/g, '');
  name = name[0].toLowerCase() + name.substring(1);
  return name;
};
const formatPropertyType = (property: ComponentPropertyDefinitions[string]) => {
  switch (property.type) {
    case 'BOOLEAN':
      return 'boolean';
    case 'TEXT':
      return 'string';
    case 'INSTANCE_SWAP':
      return 'ReactNode';
    case 'VARIANT':
      return property.variantOptions?.map(value => `'${value}'`).join(' | ') ?? 'string';
  }
};
const formatReactComponentType = (props: ComponentPropertyDefinitions) => {
  let type = '';
  for (const name in props) {
    type += `${INDENT}${formatPropertyName(name)}: ${formatPropertyType(props[name])};\n`;
  }
  return type.substring(0, type.length - 1);
};
const formatReactProps = (props: ComponentPropertyDefinitions) => {
  let properties = '';
  for (const name in props) {
    const property = props[name];
    let prop = formatPropertyName(name);
    if (property.defaultValue != null) prop += ` = ${typeof property.defaultValue === 'boolean' ? property.defaultValue : "'" + property.defaultValue + "'"}`;
    properties += `${INDENT}${prop},\n`;
  }
  return `{\n${properties.substring(0, properties.length - 2)}\n}`;
};
const formatStyle = (css?: Record<string, string>) => {
  const styles = [];
  for (const key in css) {
    styles.push(`${key}: ${css[key]}`);
  }
  return `style="${styles.join('; ')}"`;
}
const formatReactRender = (node: ReactNodeTree | string): string => {
  if (typeof node === 'string') return node;
  const name = formatReactComponentName(node.type);
  const css = formatStyle(node.css);
  if (!node.children) return `<${name} ${css}/>`;
  return `<${name} ${css}>
${node.children?.map(child => formatReactRender(child).split('\n').map(s => INDENT + s).join('\n')).join('\n') ?? ''}
</${name}>`
}

const formatToReact = (node: ReactNode) => {
  const componentName = formatReactComponentName(node.name);
  const componentPropsName = componentName + 'Props';
  return `
export type ${componentPropsName} = {
${formatReactComponentType(node.props)}
}

export const ${componentName} = (${formatReactProps(node.props)}: ${componentPropsName}) => {
    return (
${formatReactRender(node.tree).split('\n').map(s => INDENT.repeat(3) + s).join('\n')}
    );
};
`;
};

const generateReact = async () => {
  if (!figma.currentPage.selection.length) return figma.ui.postMessage({ type: 'error', message: 'No node selected!' });
  const componentSet = figma.currentPage.selection[0];
  const reactNode = await convertNodeToReact(componentSet);
  if (!reactNode) return;
  const react = formatToReact(reactNode);
  figma.ui.postMessage({ type: 'react', message: react });
};


figma.ui.onmessage = async (message) => {
  if (message === 'generate') return await generateHtml();
  if (message === 'react') return await generateReact();
  if (message === 'debug') return await debugVariables();
  if (message === 'display') return display((await generateHtml())[0]);
};
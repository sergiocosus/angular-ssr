import commander = require('commander');

import chalk = require('chalk');

import {dirname, join, resolve} from 'path';

import {cwd} from 'process';

import {
  ConfigurationException,
  FileReference,
  FileType,
  Files,
  InterprocessOutput,
  PathReference,
  PrebootConfiguration,
  Project,
  absoluteFile,
  fileFromString,
  fromJson,
  pathFromRandomId,
  pathFromString,
  HtmlOutput,
  OutputProducer,
} from '../../index';

import {CommandLineOptions} from './options';

import {validatePrebootOptionsAgainstSchema} from './preboot';

const {version} = require('../../../package.json');

export const parseCommandLineOptions = (): CommandLineOptions => {
  const options = parseCommandLine();

  const path = pathFromString(options['project']);

  const tsconfig = tsconfigFromRoot(path);

  if (path.exists() === false) {
    throw new ConfigurationException(`Project path does not exist: ${path}`);
  }

  const source = options['module'] ? options['module'].replace(/\.(js|ts)$/, String()) : null;
  const symbol = options['symbol'];

  const environment = options['environment'];

  const template = fileFromString(options['template']);

  if (template.exists() === false) {
    throw new ConfigurationException(`HTML template document does not exist: ${options['template']}`);
  }

  const debug = options['debug'] || false;

  const webpack = options['webpack'];

  const preboot = getPrebootConfiguration(options['preboot'] as string);

  const project: Project = {
    applicationModule: {source, symbol},
    basePath: rootFromTsconfig(tsconfig),
    environment,
    tsconfig,
    workingPath: pathFromRandomId(),
  };

  const output = createOutput(options);

  return {
    debug,
    output,
    preboot,
    project,
    templateDocument: template.content(),
    webpack
  };
};

const createOutput = (options): OutputProducer =>
  options['ipc']
    ? createInterprocessOutput(options)
    : createHtmlOutput(options);

const createInterprocessOutput = (options): OutputProducer => new InterprocessOutput();

const createHtmlOutput = (options): OutputProducer => {
  let outputString = options['output'];

  if (/^(\\|\/)/.test(outputString) === false) {
    outputString = join(cwd(), outputString);
  }

  const output = pathFromString(outputString);

  const inline = options['inline'] || false;

  return new HtmlOutput(output, inline);
};

const parseCommandLine = () => {
  return commander
    .version(version)
    .description(chalk.green('Prerender Angular applications'))
    .option('-d, --debug Enable debugging (stack traces and so forth)', false)
    .option('-p, --project <path>', 'Path to tsconfig.json file or project root (if tsconfig.json lives in the root)', cwd())
    .option('-w, --webpack <config>', 'Optional path to webpack configuration file')
    .option('-t, --template <path>', 'HTML template document', 'dist/index.html')
    .option('-m, --module <path>', 'Path to root application module TypeScript file')
    .option('-s, --symbol <identifier>', 'Class name of application root module')
    .option('-o, --output <path>', 'Output path to write rendered HTML documents to', 'dist')
    .option('-a, --application <application ID>', 'Optional application ID if your CLI configuration contains multiple apps')
    .option('-b, --preboot [file or json]', 'Enable preboot and optionally read the preboot configuration from the specified JSON file (otherwise will use sensible defaults and automatically find the root element name)', null)
    .option('-i, --inline', 'Inline of resources referenced in head > link')
    .option('-I, --ipc', 'Send rendered documents to parent process through IPC instead of writing them to disk', false)
    .parse(process.argv);
};

const rootFromTsconfig = (tsconfig: FileReference): PathReference => {
  const parsed = fromJson<{extends?: string}>(tsconfig.content());

  if (parsed.extends) {
    return pathFromString(resolve(dirname(join(tsconfig.parent().toString(), parsed.extends))));
  }
  else {
    return tsconfig.parent();
  }
};

const tsconfigFromRoot = (fromRoot: PathReference): FileReference => {
  if (fromRoot.exists() === false) {
    throw new ConfigurationException(`Root path does not exist: ${fromRoot}`);
  }

  if (fromRoot.type() === FileType.File) {
    return fileFromString(fromRoot.toString());
  }

  for (const tsc of Files.tsconfig) {
    const candidates = [
      fromRoot,
      ...Array.from(fromRoot.directories()),
      ...Array.from(fromRoot.parent().directories())
    ].filter(p => /(\\|\/)e2e(\\|\/)/.test(p.toString()) === false);

    const found = candidates.map(d => fileFromString(join(d.toString(), tsc))).find(c => c.exists());
    if (found) {
      return found;
    }
  }

  return null;
};

const getPrebootConfiguration = (filenameOrJson: string): PrebootConfiguration => {
  if (filenameOrJson == null || filenameOrJson.length === 0) {
    return null;
  }

  let options: PrebootConfiguration;

  if (filenameOrJson.startsWith('{')) {
    try {
      options = fromJson<PrebootConfiguration>(filenameOrJson);
    }
    catch (exception) {
      throw new ConfigurationException('Preboot configuration: invalid JSON document', exception);
    }
  }
  else {
    const file = absoluteFile(cwd(), filenameOrJson);

    if (file.exists() === false || file.type() !== FileType.File) {
      throw new ConfigurationException(`Preboot configuration file does not exist or is not a file: ${file.toString()}`);
    }

    options = fromJson<PrebootConfiguration>(file.content());
  }

  const validation = validatePrebootOptionsAgainstSchema(options);

  if (validation.errors.length > 0) {
    throw new ConfigurationException(`Preboot configuration ${filenameOrJson} is invalid: ${validation.toString()}`)
  }

  return options;
};
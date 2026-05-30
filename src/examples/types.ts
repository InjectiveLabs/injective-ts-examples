export type ExampleCategory = "authz" | "cosmjs" | "queries" | "transactions";

export type ExampleRun = () => Promise<void>;

export interface ExampleMetadata {
  readonly id: string;
  readonly category: ExampleCategory;
  readonly title: string;
  readonly description: string;
  readonly requiresEnvironment?: readonly string[];
  readonly mayBroadcast?: boolean;
}

export interface ExampleDefinition extends ExampleMetadata {
  readonly filePath: string;
  readonly run: ExampleRun;
}

export interface ExampleModule {
  readonly metadata: ExampleMetadata;
  readonly run: ExampleRun;
}

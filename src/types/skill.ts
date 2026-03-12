export interface Skill {
  name: string;
  description: string;
  parameters: any;
  run: (args: any) => Promise<any>;
}

import { NetworkError } from '../model/errors.js';
import { openProject } from '../project/root.js';
import { planUpgrade,applyApprovedUpgrade } from '../project/upgrade.js';
export async function runUpgrade(argv:string[]):Promise<number>{
  if(argv[0]!=='--project-root'||!argv[1]||argv[2]!=='--project-id'||!argv[3]||argv[4]!=='--name'||!argv[5])throw new NetworkError('upgrade_usage','Provide explicit root, project UUID and name');
  const project=await openProject(argv[1]);const identity={id:argv[3],name:argv[5]};const flags=argv.slice(6);
  if(flags.length===1&&flags[0]==='--dry-run'){process.stdout.write(JSON.stringify(await planUpgrade(project,identity),null,2)+'\n');return 0;}
  if(flags.length===2&&flags[0]==='--approve-and-apply'&&flags[1]){const result=await applyApprovedUpgrade(project,identity,flags[1]);process.stdout.write(JSON.stringify(result)+'\n');return 0;}
  throw new NetworkError('upgrade_usage','Preview then apply the exact receipt');
}

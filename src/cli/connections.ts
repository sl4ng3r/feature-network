import { openRegular } from '../storage/regular.js';
import { digest } from '../storage/journal.js';
import { openProject } from '../project/root.js';
import { planConnections,applyConnections,parseConnections } from '../project/connections.js';
import { NetworkError } from '../model/errors.js';
export async function runConnections(argv:string[]):Promise<number>{
 if(argv[0]!=='--project-root'||!argv[1]||argv[2]!=='--config-file'||!argv[3])throw new NetworkError('connections_usage','Provide root and local selection file');
 const handle=await openRegular(argv[3]);let bytes:Buffer;
 try{if((await handle.stat()).size>65536)throw new NetworkError('invalid_schema','Connections file too large');bytes=await handle.readFile();if(bytes.length>65536)throw new NetworkError('invalid_schema','Connections file too large');}finally{await handle.close();}
 const project=await openProject(argv[1]);const config=parseConnections(new TextDecoder('utf-8',{fatal:true}).decode(bytes));const plan=await planConnections(project,config,digest(bytes));const flags=argv.slice(4);
 if(flags.length===1&&flags[0]==='--dry-run'){process.stdout.write(JSON.stringify(plan,null,2)+'\n');return 0;}
 if(flags.length===2&&flags[0]==='--approve-and-apply'&&flags[1]){if(plan.receipt!==flags[1])throw new NetworkError('conflict','Connection approval is stale');await applyConnections(plan);process.stdout.write(JSON.stringify({status:'applied',revision:plan.receipt})+'\n');return 0;}
 throw new NetworkError('connections_usage','Preview then approve the exact receipt');
}

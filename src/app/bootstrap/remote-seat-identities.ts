import type { EngineSession, SessionClient, SessionSeat } from "../../world/session/session.ts";

export interface RemoteSeatIdentity { readonly client: SessionClient; readonly seat: SessionSeat; }

/** Reserve frontend identities; each native server independently assigns its wire player number. */
export function prepareRemoteSeatIdentities(session: EngineSession, retained: readonly RemoteSeatIdentity[], count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("Remote play requires one to four local players");
  const selected = retained.slice(0,count);
  const added: RemoteSeatIdentity[] = [];
  const discardAdded = (): void => {
    const failures: unknown[]=[];
    for(const entry of [...added].reverse()) try{entry.client.close();}catch(error){failures.push(error);}
    if(failures.length!==0)throw new AggregateError(failures,"Remote seat identity cleanup failed");
  };
  try {
    while(selected.length<count){
      let slot=0;while(session.clientAt(slot)!==null || added.some(entry=>entry.client.id.slot===slot))slot++;
      let index=0;while(retained.some(entry=>entry.seat.id.index===index) || added.some(entry=>entry.seat.id.index===index))index++;
      const client=session.prepareClient(slot);
      try {const entry={client,seat:session.prepareSeat(index,client)};added.push(entry);selected.push(entry);}
      catch(error){try{client.close();}catch(cleanup){throw new AggregateError([error,cleanup],"Remote seat reservation failed");}throw error;}
    }
  }catch(error){try{discardAdded();}catch(cleanup){throw new AggregateError([error,cleanup],"Remote seat preparation failed");}throw error;}
  let phase:"prepared"|"published"|"discarded"="prepared";
  const clients={added:added.map(entry=>entry.client),removed:[]};
  const seats={added:added.map(entry=>entry.seat),removed:[]};
  return {
    get published():boolean{return phase==="published";},
    selected: [...selected],
    added: [...added],
    validate():void {if(phase!=="prepared")throw new Error(`Remote seat identities are ${phase}`);session.validateLocalSeats([],clients,seats);},
    publish():void {this.validate();session.publishLocalSeats([],clients,seats).close();phase="published";},
    discard():void {if(phase!=="prepared")return;phase="discarded";discardAdded();},
  };
}

import { z } from 'zod';
const key=z.string().max(160).regex(/^[a-zA-Z0-9_-]*$/);
const number=z.number().finite().min(0).max(10000000);
const percent=z.number().min(0).max(100);
export const websiteBatch=z.object({
  version:z.literal(1),site:z.enum(['hareb.digital','issahareb.me']),session:z.uuid(),page:z.uuid(),
  path:z.string().max(200).regex(/^\/[a-zA-Z0-9_/-]*$/),
  events:z.array(z.object({id:z.uuid(),at:z.number().int().positive(),
    event:z.enum(['page_view','engagement','page_exit','section_view','section_time','scroll_depth','scroll_stop','click','form_start','form_field','form_invalid','form_attempt','form_success','form_error','video_play','video_pause','video_ended']),
    data:z.object({section:key.optional(),target:key.optional(),field:key.optional(),form:z.uuid().optional(),
      destination:z.string().max(240).regex(/^(?:|tel:|mailto:|https?:\/\/[a-zA-Z0-9.:-]+\/[a-zA-Z0-9_./%~-]*)$/).optional(),
      referrer:z.string().max(200).regex(/^[a-zA-Z0-9.-]*$/).optional(),device:z.enum(['mobile','tablet','desktop']).optional(),
      seconds:number.optional(),order:number.int().optional(),depth:percent.optional(),maxDepth:percent.optional(),currentDepth:percent.optional(),
      scrollY:number.optional(),width:number.optional(),height:number.optional(),x:percent.optional(),y:percent.optional(),muted:z.union([z.literal(0),z.literal(1)]).optional()
    }).strip()
  })).min(1).max(40)
});

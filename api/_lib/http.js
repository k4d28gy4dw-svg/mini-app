export function json(res,status,body){res.status(status).setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(body))}
export function method(req,res,allowed){if(!allowed.includes(req.method)){res.setHeader('allow',allowed.join(', '));json(res,405,{error:'Method not allowed'});return false}return true}

import { Jimp } from 'jimp';
for(const f of ['debirupapia1.png','debirupapia2.png','mauntengorira.png']){
  const img = await Jimp.read('public/'+f);
  const {width:W,height:H}=img.bitmap;
  const bg = new Jimp({width:W,height:H,color:0x00FF00FF}); // lime
  bg.composite(img,0,0);
  bg.resize({w:300});
  await bg.write('public/_v_'+f);
}
console.log('ok');

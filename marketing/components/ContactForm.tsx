"use client";
import {useState,type FormEvent} from "react";
const id=process.env.NEXT_PUBLIC_FORMSPREE_ID;
const enabled=!!id && id!=="FORM_ID" && /^[a-zA-Z0-9]+$/.test(id);
export default function ContactForm(){
 const [state,setState]=useState<"idle"|"sending"|"sent"|"failed">("idle");
 const [error,setError]=useState("");
 async function submit(e:FormEvent<HTMLFormElement>){
 e.preventDefault();
 if(!enabled){setError("Contact form setup is pending. The founder must add a verified Formspree ID before enquiries can be submitted.");setState("failed");return;}
 const form=e.currentTarget;const data=new FormData(form);
 if(String(data.get("_gotcha")||"").trim())return;
 setState("sending");setError("");
 try{
 const response=await fetch("https://formspree.io/f/"+id,{method:"POST",headers:{Accept:"application/json"},body:data});
 if(!response.ok)throw new Error("Your message could not be submitted. Please try again.");
 setState("sent");form.reset();
 }catch(ex){setState("failed");setError(ex instanceof Error?ex.message:"Message not sent.");}
 }
 if(state==="sent")return <div className="rounded-md border border-[#B8D7C5] bg-sage p-6" role="status"><h3 className="font-semibold text-pine">Message submitted.</h3><p className="mt-2 text-sm leading-6">Thank you. We'll follow up using the email you provided.</p><button className="mt-4 underline text-sm" onClick={()=>setState("idle")}>Send another message</button></div>;
 return <form onSubmit={submit} className="grid gap-4" aria-label="Replay contact form">
 <p className="text-xs leading-6 text-quiet">Please don’t submit customer information, banking credentials or historical records here. We will agree a separate transfer process for case files.</p>
 <div className="grid gap-4 sm:grid-cols-2">
 <label className="form-label">Name <input name="name" required maxLength={120} autoComplete="name" placeholder="Your name"/></label>
 <label className="form-label">Work email <input name="email" required type="email" maxLength={180} autoComplete="email" placeholder="name@company.com"/></label>
 </div>
 <div className="grid gap-4 sm:grid-cols-2">
 <label className="form-label">Company <input name="company" required maxLength={140} autoComplete="organization" placeholder="Company name"/></label>
 <label className="form-label">Role <input name="role" maxLength={100} placeholder="Head of Treasury"/></label>
 </div>
 <label className="form-label">How does your team manage advances today? <textarea name="message" rows={4} maxLength={1500} placeholder="A brief description of your current workflow…" required/></label>
 <div className="hidden" aria-hidden="true"><input name="_gotcha" tabIndex={-1} autoComplete="off"/></div>
 <p className="text-xs leading-6 text-quiet">By submitting, you agree that Clearline may use your details to respond to this enquiry. See our <a href="/privacy" className="underline">privacy notice</a>.</p>
 {state==="failed"&&<div className="rounded bg-[#FFF1EE] p-3 text-sm text-brick" role="alert">{error}</div>}
 {!enabled&&<div className="rounded border border-[#E4D7BF] bg-[#FFF9ED] px-3 py-2 text-xs text-[#79541E]">Form not activated yet · Formspree ID required</div>}
 <button disabled={state==="sending"||!enabled} type="submit" className="btn btn-primary w-fit">{state==="sending"?"Sending…":"Request a five-case replay"} <span aria-hidden="true">→</span></button>
 </form>;
}

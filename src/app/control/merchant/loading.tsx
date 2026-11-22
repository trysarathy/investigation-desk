import s from "@/components/control/control.module.css";

export default function MerchantLoading() {
  return <div aria-busy="true" role="status"><p className={s.muted}>Loading the stored reconciliation…</p></div>;
}

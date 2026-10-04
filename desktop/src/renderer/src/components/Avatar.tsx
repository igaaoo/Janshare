import { initials } from "../lib/links";

type Props = {
  name: string;
  color: string;
  size?: number;
  live?: boolean;
  status?: "online" | "none";
};

export function Avatar({ name, color, size = 32, live, status = "none" }: Props) {
  return (
    <div className={`avatar${live ? " avatar-live" : ""}`} style={{ width: size, height: size }}>
      <div className="avatar-circle" style={{ background: color, fontSize: size * 0.38 }}>
        {initials(name)}
      </div>
      {status === "online" && <span className="avatar-status" />}
    </div>
  );
}

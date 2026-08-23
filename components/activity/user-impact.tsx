import styles from "@/app/home.module.css"
import Link from "next/link";

type UserImpactProps = {
  users: {
    name: string,
    id: number | null,
    impact: number;
  }[]
};
export const UsersImpact = ({ users }: UserImpactProps) => {
  // Sort asscending
  users.sort((user1, user2) => user2.impact - user1.impact);
  const rows = [];
  let i = 1;
  for (const user of users) {
    rows.push((<tr key={i} className={styles.userImpactRow}>
      <td className={styles.userImpactRank}>{i}</td>
      <td className={styles.userImpactCell}>{user.id ? <Link href={"/people/" + user.id} className={styles.textLink}>{user.name}</Link> : user.name}</td>
      <td className={styles.userImpactCell}>{user.impact.toPrecision(4)}</td>
    </tr>));
    i++;
  }
  return (<div className={styles.userImpactPanel}>
    <h2 className="text-xl font-semibold pt-2" style={{ paddingTop: 0 }}>
      User Impact Rankings
    </h2>
    <table className={styles.userImpactTable}>
      <tbody>
        <tr key={0} className={styles.userImpactRow}>
          <td className={styles.userImpactHeader} style={{ textAlign: "center" }}>Rank</td>
          <td className={styles.userImpactHeader}>User</td>
          <td className={styles.userImpactHeader}>Score</td>
        </tr>
        {rows.map(row => row)}
      </tbody>
    </table>
  </div >);
};

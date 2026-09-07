import classNames from "@calcom/ui/classNames";

export function Logo({
  small,
  icon,
  inline = true,
  className,
  src,
}: {
  small?: boolean;
  icon?: boolean;
  inline?: boolean;
  className?: string;
  src?: string;
}) {
  return (
    <h3 className={classNames("logo", inline && "inline", className)}>
      <strong>
        {icon ? (
          <img
            className="mx-auto w-9"
            alt="Rythms Cal"
            title="Rythms Cal"
            src={src ? `${src}?type=icon` : "/rythms-icon.svg"}
          />
        ) : (
          <img
            className={classNames(small ? "h-4 w-auto" : "h-5 w-auto", "dark:invert")}
            alt="Rythms Cal"
            title="Rythms Cal"
            src={src || "/rythms-logo.svg"}
          />
        )}
      </strong>
    </h3>
  );
}

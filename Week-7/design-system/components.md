# Components (shadcn/ui 스타일)

shadcn/ui의 컴포넌트 API를 CDN 단일 파일 환경(React + Tailwind + Babel standalone)에 맞게 옮긴 스니펫. 토큰을 통해 색이 결정되므로 **이 컴포넌트 코드는 모든 팔레트에서 동일하게 동작**한다.

규칙
- 모든 컴포넌트는 `className`으로 외부 확장 가능
- variant/size 명명은 shadcn 공식 그대로 (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`)
- 색은 절대 hex/rgb 직접 쓰지 말고 토큰(`bg-primary`, `text-foreground`, `border-border` 등)으로만 표현
- `cn()` 헬퍼는 단순 문자열 join으로 대체 (`clsx`/`tailwind-merge` 미사용 환경)

```jsx
const cn = (...classes) => classes.filter(Boolean).join(' ');
```

---

## 1. Button (shadcn API)

```jsx
function Button({
  variant = "default",
  size = "default",
  className = "",
  asChild = false,
  ...props
}) {
  const base = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
  const variants = {
    default:     "bg-primary text-primary-foreground hover:bg-primary/90",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    outline:     "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    secondary:   "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ghost:       "hover:bg-accent hover:text-accent-foreground",
    link:        "text-primary underline-offset-4 hover:underline",
  };
  const sizes = {
    default: "h-10 px-4 py-2",
    sm:      "h-9 rounded-md px-3",
    lg:      "h-11 rounded-md px-8",
    icon:    "h-10 w-10",
  };
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props} />
  );
}
```

---

## 2. Input

```jsx
function Input({ className = "", type = "text", ...props }) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
```

---

## 3. Label

```jsx
function Label({ className = "", htmlFor, children, ...props }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    >
      {children}
    </label>
  );
}
```

---

## 4. Card (Header / Title / Description / Content / Footer)

```jsx
function Card({ className = "", ...props }) {
  return <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />;
}
function CardHeader({ className = "", ...props }) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}
function CardTitle({ className = "", ...props }) {
  return <h3 className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />;
}
function CardDescription({ className = "", ...props }) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
function CardContent({ className = "", ...props }) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
function CardFooter({ className = "", ...props }) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
```

---

## 5. Badge

```jsx
function Badge({ variant = "default", className = "", ...props }) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
  const variants = {
    default:     "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
    secondary:   "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
    outline:     "text-foreground",
  };
  return <div className={cn(base, variants[variant], className)} {...props} />;
}
```

---

## 6. Checkbox

```jsx
function Checkbox({ checked, onCheckedChange, className = "", id }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      id={id}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-primary",
        "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked && "bg-primary text-primary-foreground",
        className
      )}
    >
      {checked && (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      )}
    </button>
  );
}
```

---

## 7. Dialog (Modal)

shadcn은 Radix Dialog를 쓰지만, CDN 환경에서는 가벼운 자체 구현으로 대체한다. API는 `<Dialog open onOpenChange>` 패턴으로 유지.

```jsx
function Dialog({ open, onOpenChange, children }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onOpenChange?.(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => onOpenChange?.(false)}>
      <div className="fixed inset-0 bg-black/80 data-[state=open]:animate-in" />
      <div className="relative z-50" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
function DialogContent({ className = "", children }) {
  return (
    <div className={cn(
      "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg -translate-x-[50%] -translate-y-[50%] gap-4",
      "border bg-background p-6 shadow-lg sm:rounded-lg",
      className
    )}>
      {children}
    </div>
  );
}
function DialogHeader({ className = "", ...props }) {
  return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />;
}
function DialogTitle({ className = "", ...props }) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}
function DialogDescription({ className = "", ...props }) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
function DialogFooter({ className = "", ...props }) {
  return <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />;
}
```

---

## 8. Separator

```jsx
function Separator({ orientation = "horizontal", className = "" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
    />
  );
}
```

---

## 9. Avatar

```jsx
function Avatar({ className = "", children }) {
  return <span className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}>{children}</span>;
}
function AvatarImage({ src, alt = "", className = "" }) {
  return <img src={src} alt={alt} className={cn("aspect-square h-full w-full", className)} />;
}
function AvatarFallback({ className = "", children }) {
  return <span className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted text-sm", className)}>{children}</span>;
}
```

---

## 10. Switch

```jsx
function Switch({ checked, onCheckedChange, className = "" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className
      )}
    >
      <span className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
        checked ? "translate-x-5" : "translate-x-0"
      )} />
    </button>
  );
}
```

---

## 11. Toast (간이)

shadcn `useToast` 패턴을 가벼운 Provider로 재현.

```jsx
const ToastContext = React.createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const toast = React.useCallback(({ title, description, variant = "default" }) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, title, description, variant }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex max-w-[420px] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn(
            "rounded-md border p-4 shadow-lg",
            t.variant === "destructive"
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "border bg-background text-foreground"
          )}>
            {t.title && <div className="font-semibold text-sm">{t.title}</div>}
            {t.description && <div className="text-sm opacity-90">{t.description}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
const useToast = () => React.useContext(ToastContext);
```

---

## 12. 사용 예 (모든 팔레트에서 동일)

```jsx
function Demo() {
  const [open, setOpen] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>shadcn 토큰 기반 디자인 시스템</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">이름</Label>
            <Input id="name" placeholder="홍길동" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={agreed} onCheckedChange={setAgreed} id="agree" />
            <Label htmlFor="agree">약관 동의</Label>
          </div>
          <div className="flex gap-2">
            <Badge>NEW</Badge>
            <Badge variant="secondary">DEMO</Badge>
            <Badge variant="outline">v0.1</Badge>
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" className="flex-1">취소</Button>
          <Button className="flex-1" disabled={!agreed} onClick={() => setOpen(true)}>다음</Button>
        </CardFooter>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>확인</DialogTitle>
            <DialogDescription>제출하시겠습니까?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={() => setOpen(false)}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

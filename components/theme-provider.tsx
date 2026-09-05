"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}

export function ThemeToggle({
  alwaysVisible = false
}: {
  alwaysVisible?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "group",
            !alwaysVisible && "invisible max-w-0 sm:visible sm:max-w-none"
          )}
          aria-label="Choose appearance"
        >
          <Sun className="scale-100 rotate-0 transition-transform motion-reduce:transition-none dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute scale-0 rotate-90 transition-transform motion-reduce:transition-none dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ThemeChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ThemeMenu() {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Appearance</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ThemeChoices />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function ThemeChoices() {
  const { theme = "system", setTheme } = useTheme()

  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  )
}

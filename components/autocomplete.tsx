import useSize from "@react-hook/size"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  useState,
  useRef,
  useCallback,
  type ComponentProps,
  type KeyboardEvent,
  useMemo,
  ReactElement
} from "react"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import fuzzysort from "fuzzysort"
import { cn } from "@/lib/utils"

export interface Option extends Record<string, string | number> {
  value: string
}

type AutoCompleteProps = Omit<
  ComponentProps<"input">,
  "defaultValue" | "onBlur" | "onChange" | "onKeyDown" | "value"
> & {
  options: Option[]
  defaultValue?: string
  searchKeys?: string[]
  onValueChange?: (value: string) => void
  renderFn?: (option: Option) => ReactElement
  isLoading?: boolean
}

export const AutoComplete = ({
  options,
  placeholder,
  defaultValue,
  searchKeys,
  onValueChange,
  disabled,
  renderFn,
  className,
  ...inputProps
}: AutoCompleteProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [width] = useSize(inputRef.current)

  const [isOpen, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [inputValue, setInputValue] = useState<string>(defaultValue || "")

  const [parentNode, setParentNode] = useState<HTMLDivElement | null>(null)
  const setParent = useCallback((node: HTMLDivElement | null) => {
    if (!node) return

    setParentNode(node)
  }, [])

  const filteredOptions = useMemo(
    () =>
      fuzzysort
        .go(inputValue, options, {
          keys: ["value", ...(searchKeys || [])],
          all: true
        })
        .map((res) => res.obj),
    [inputValue, options, searchKeys]
  )

  const rowVirtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => parentNode,
    estimateSize: () => 36
  })

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const input = inputRef.current
      if (!input) {
        return
      }

      // Keep the options displayed when the user is typing
      if (!isOpen) {
        setOpen(true)
      }

      // This is not a default behaviour of the <input /> field
      if (event.key === "Enter") {
        event.preventDefault()
        const optionToSelect = filteredOptions[selectedIndex]

        if (optionToSelect) {
          setInputValue(optionToSelect.value)
          onValueChange?.(optionToSelect.value)
        } else onValueChange?.(input.value)

        setOpen(false)
        setSelectedIndex(0)
      }

      if (
        event.key === "ArrowDown" &&
        selectedIndex < filteredOptions.length - 1
      )
        setSelectedIndex(selectedIndex + 1)

      if (event.key === "ArrowUp" && selectedIndex > 0)
        setSelectedIndex(selectedIndex - 1)

      if (event.key === "Escape") {
        input.blur()
      }
    },
    [isOpen, filteredOptions, onValueChange, selectedIndex]
  )

  const blur = useCallback(() => {
    setOpen(false)
    setSelectedIndex(0)
    onValueChange?.(inputRef.current?.value || "")
  }, [onValueChange])

  const select = useCallback(
    (option: string) => {
      setOpen(false)
      setSelectedIndex(0)
      setInputValue(option)
      onValueChange?.(option)
    },
    [onValueChange]
  )

  return (
    <div ref={containerRef}>
      <Popover onOpenChange={() => undefined} open={isOpen}>
        <PopoverTrigger asChild>
          <div className="relative w-full">
            <Input
              {...inputProps}
              ref={inputRef}
              value={inputValue}
              onKeyDown={handleKeyDown}
              onChange={(event) => {
                setInputValue(event.target.value)
                onValueChange?.(event.target.value)
              }}
              onBlur={() => blur()}
              onFocus={() => setOpen(true)}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                "w-full rounded-md border border-border bg-secondary-light text-sm placeholder-light",
                className
              )}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          style={{ width: `${width}px`, scrollbarWidth: "none" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          ref={setParent}
          className="max-h-[300px] overflow-y-auto !p-1"
        >
          {filteredOptions.length === 0 && (
            <div
              onClick={() => select(inputValue)}
              className="cursor-default rounded-md bg-secondary p-2 text-sm"
            >
              {inputValue}
            </div>
          )}
          <div
            style={{ height: rowVirtualizer.getTotalSize() }}
            className="group relative w-full text-sm"
          >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const option = filteredOptions[virtualItem.index]!

              return (
                <div
                  key={virtualItem.key as string}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()

                    select(option.value)
                  }}
                  onMouseOver={() => setSelectedIndex(virtualItem.index)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                  className={cn(
                    "flex cursor-default gap-2 rounded-md p-2 transition-colors",
                    virtualItem.index === selectedIndex &&
                      "bg-secondary group-hover:bg-secondary-dark group-hover:hover:bg-secondary"
                  )}
                >
                  {renderFn ? renderFn(option) : option.value}
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

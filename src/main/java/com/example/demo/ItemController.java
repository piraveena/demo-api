package com.example.demo;

import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

@RestController
@RequestMapping("/api/items")
public class ItemController {

    private final List<Item> items = new ArrayList<>();
    private final AtomicLong counter = new AtomicLong();

    @GetMapping
    public List<Item> getAll() {
        return items;
    }

    @GetMapping("/{id}")
    public Item getById(@PathVariable long id) {
        return items.stream()
                .filter(i -> i.getId() == id)
                .findFirst()
                .orElseThrow(() -> new RuntimeException("Item not found: " + id));
    }

    @PostMapping
    public Item create(@RequestBody Item item) {
        item.setId(counter.incrementAndGet());
        items.add(item);
        return item;
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        items.removeIf(i -> i.getId() == id);
    }
}
